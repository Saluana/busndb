import { z } from 'zod';
import type { Driver, CollectionSchema, InferSchema } from './types';
import { QueryBuilder, FieldBuilder } from './query-builder';
import { SQLTranslator } from './sql-translator';
import { SchemaSQLGenerator } from './schema-sql-generator.js';
import {
    ValidationError,
    NotFoundError,
    UniqueConstraintError,
} from './errors.js';
import { parseDoc, mergeConstrainedFields } from './json-utils.js';
import type { QueryablePaths, OrderablePaths } from './types/nested-paths';
import type { PluginManager } from './plugin-system';
import { Migrator } from './migrator';

export class Collection<T extends z.ZodSchema> {
    private driver: Driver;
    private collectionSchema: CollectionSchema<InferSchema<T>>;
    private pluginManager?: PluginManager;
    private database?: any; // Reference to the Database instance

    private isInitialized = false;
    private initializationPromise?: Promise<void>;

    constructor(
        driver: Driver,
        schema: CollectionSchema<InferSchema<T>>,
        pluginManager?: PluginManager,
        database?: any
    ) {
        this.driver = driver;
        this.collectionSchema = schema;
        this.pluginManager = pluginManager;
        this.database = database;
        this.createTable();
    }

    private createTable(): void {
        // Try sync table creation first for backward compatibility
        // Fall back to async initialization if sync methods aren't available (shared connections)
        try {
            this.createTableSync();
            this.initializationPromise = this.runMigrationsAsync();
        } catch (error) {
            // If sync methods fail (e.g., shared connection), initialize everything async
            if (error instanceof Error && error.message.includes('not supported when using a shared connection')) {
                this.initializationPromise = this.initializeTableAsync();
            } else {
                console.warn(`Table creation failed for collection '${this.collectionSchema.name}':`, error);
                this.initializationPromise = this.runMigrationsAsync();
            }
        }
    }

    private createTableSync(): void {
        const { sql, additionalSQL } =
            SchemaSQLGenerator.buildCreateTableWithConstraints(
                this.collectionSchema.name,
                this.collectionSchema.constraints,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );

        try {
            // Use sync methods for initial table creation
            this.driver.execSync(sql);

            // Execute additional SQL for indexes and constraints
            for (const additionalQuery of additionalSQL) {
                this.driver.execSync(additionalQuery);
            }
            
            this.isInitialized = true;
        } catch (error) {
            if (!(error instanceof Error && error.message.includes('already exists'))) {
                throw error;
            } else {
                this.isInitialized = true;
            }
        }
    }

    private async initializeTableAsync(): Promise<void> {
        const migrator = new Migrator(this.driver);
        
        try {
            await migrator.checkAndRunMigration(this.collectionSchema, this, this.database);
        } catch (error) {
            console.warn(`Migration check failed for collection '${this.collectionSchema.name}':`, error);
        }

        const { sql, additionalSQL } =
            SchemaSQLGenerator.buildCreateTableWithConstraints(
                this.collectionSchema.name,
                this.collectionSchema.constraints,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );

        try {
            await this.driver.exec(sql);

            for (const additionalQuery of additionalSQL) {
                await this.driver.exec(additionalQuery);
            }
            
            this.isInitialized = true;
        } catch (error) {
            if (!(error instanceof Error && error.message.includes('already exists'))) {
                console.warn(`Table creation failed for collection '${this.collectionSchema.name}':`, error);
            } else {
                this.isInitialized = true;
            }
        }
    }

    private async runMigrationsAsync(): Promise<void> {
        try {
            const migrator = new Migrator(this.driver);
            await migrator.checkAndRunMigration(this.collectionSchema, this, this.database);
        } catch (error) {
            // Migration errors are non-fatal for backwards compatibility
            console.warn(`Migration check failed for collection '${this.collectionSchema.name}':`, error);
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized && this.initializationPromise) {
            await this.initializationPromise;
        }
    }

    private validateDocument(doc: any): InferSchema<T> {
        try {
            return this.collectionSchema.schema.parse(doc);
        } catch (error) {
            throw new ValidationError('Document validation failed', error);
        }
    }

    private generateId(): string {
        return crypto.randomUUID();
    }

    async insert(doc: Omit<InferSchema<T>, 'id'>): Promise<InferSchema<T>> {
        await this.ensureInitialized();
        
        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'insert',
            data: doc,
        };

        // Execute before hook (now properly awaited)
        await this.pluginManager?.executeHookSafe('onBeforeInsert', context);

        try {
            // Check if id is provided in doc (via type assertion)
            const docWithPossibleId = doc as any;
            let id: string;

            if (docWithPossibleId.id) {
                // If id is provided, validate it and check for duplicates
                id = docWithPossibleId.id;

                // Check if this id already exists
                const existing = await this.findById(id);
                if (existing) {
                    throw new UniqueConstraintError(
                        `Document with id '${id}' already exists`,
                        'id'
                    );
                }
            } else {
                id = this.generateId();
            }

            const fullDoc = { ...doc, id };
            const validatedDoc = this.validateDocument(fullDoc);

            // Constraints are now enforced at the SQL level via constrainedFields

            const { sql, params } = SQLTranslator.buildInsertQuery(
                this.collectionSchema.name,
                validatedDoc,
                id,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );
            await this.driver.exec(sql, params);

            // Execute after hook (now properly awaited)
            const resultContext = { ...context, result: validatedDoc };
            await this.pluginManager?.executeHookSafe(
                'onAfterInsert',
                resultContext
            );

            return validatedDoc;
        } catch (error) {
            // Execute error hook (now properly awaited)
            const errorContext = { ...context, error: error as Error };
            await this.pluginManager?.executeHookSafe('onError', errorContext);

            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    // Extract field name from SQLite error message
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        (doc as any).id || 'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    async insertBulk(
        docs: Omit<InferSchema<T>, 'id'>[]
    ): Promise<InferSchema<T>[]> {
        await this.ensureInitialized();
        if (docs.length === 0) return [];
        
        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'insertBulk',
            data: docs,
        };

        await this.pluginManager?.executeHookSafe('onBeforeInsert', context);

        try {
            const validatedDocs: InferSchema<T>[] = [];
            const sqlParts: string[] = [];
            const allParams: any[] = [];

            for (const doc of docs) {
                const docWithPossibleId = doc as any;
                let id: string;

                if (docWithPossibleId.id) {
                    id = docWithPossibleId.id;
                    const existing = await this.findById(id);
                    if (existing) {
                        throw new UniqueConstraintError(
                            `Document with id '${id}' already exists`,
                            'id'
                        );
                    }
                } else {
                    id = this.generateId();
                }

                const fullDoc = { ...doc, id };
                const validatedDoc = this.validateDocument(fullDoc);
                validatedDocs.push(validatedDoc);

                const { sql, params } = SQLTranslator.buildInsertQuery(
                    this.collectionSchema.name,
                    validatedDoc,
                    id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );

                const valuePart = sql.substring(sql.indexOf('VALUES ') + 7);
                sqlParts.push(valuePart);
                allParams.push(...params);
            }

            const firstQuery = SQLTranslator.buildInsertQuery(
                this.collectionSchema.name,
                validatedDocs[0],
                (validatedDocs[0] as any).id,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );
            const baseSQL = firstQuery.sql.substring(0, firstQuery.sql.indexOf('VALUES ') + 7);
            const batchSQL = baseSQL + sqlParts.join(', ');

            await this.driver.exec(batchSQL, allParams);

            const resultContext = { ...context, result: validatedDocs };
            await this.pluginManager?.executeHookSafe('onAfterInsert', resultContext);

            return validatedDocs;
        } catch (error) {
            const errorContext = { ...context, error: error as Error };
            await this.pluginManager?.executeHookSafe('onError', errorContext);

            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    async put(
        id: string,
        doc: Partial<InferSchema<T>>
    ): Promise<InferSchema<T>> {
        await this.ensureInitialized();
        const existing = await this.findById(id);
        if (!existing) {
            throw new NotFoundError('Document not found', id);
        }

        const updatedDoc = { ...existing, ...doc, id };
        const validatedDoc = this.validateDocument(updatedDoc);

        // Plugin hook: before update
        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'update',
            data: validatedDoc,
        };
        await this.pluginManager?.executeHookSafe('onBeforeUpdate', context);

        // Constraints are now enforced at the SQL level via constrainedFields
        const { sql, params } = SQLTranslator.buildUpdateQuery(
            this.collectionSchema.name,
            validatedDoc,
            id,
            this.collectionSchema.constrainedFields,
            this.collectionSchema.schema
        );
        await this.driver.exec(sql, params);

        // Plugin hook: after update
        const resultContext = {
            ...context,
            result: validatedDoc,
        };
        await this.pluginManager?.executeHookSafe('onAfterUpdate', resultContext);

        return validatedDoc;
    }

    async putBulk(
        updates: { id: string; doc: Partial<InferSchema<T>> }[]
    ): Promise<InferSchema<T>[]> {
        if (updates.length === 0) return [];

        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'putBulk',
            data: updates,
        };

        await this.pluginManager?.executeHookSafe('onBeforeUpdate', context);

        try {
            const validatedDocs: InferSchema<T>[] = [];
            const sqlStatements: { sql: string; params: any[] }[] = [];

            for (const update of updates) {
                const existing = await this.findById(update.id);
                if (!existing) {
                    throw new NotFoundError('Document not found', update.id);
                }

                const updatedDoc = { ...existing, ...update.doc, id: update.id };
                const validatedDoc = this.validateDocument(updatedDoc);
                validatedDocs.push(validatedDoc);

                const { sql, params } = SQLTranslator.buildUpdateQuery(
                    this.collectionSchema.name,
                    validatedDoc,
                    update.id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );
                sqlStatements.push({ sql, params });
            }

            await this.driver.exec('BEGIN TRANSACTION', []);
            try {
                for (const statement of sqlStatements) {
                    await this.driver.exec(statement.sql, statement.params);
                }
                await this.driver.exec('COMMIT', []);
            } catch (error) {
                await this.driver.exec('ROLLBACK', []);
                throw error;
            }

            const resultContext = { ...context, result: validatedDocs };
            await this.pluginManager?.executeHookSafe('onAfterUpdate', resultContext);

            return validatedDocs;
        } catch (error) {
            const errorContext = { ...context, error: error as Error };
            await this.pluginManager?.executeHookSafe('onError', errorContext);

            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    async delete(id: string): Promise<boolean> {
        // Plugin hook: before delete
        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'delete',
            data: { id },
        };
        await this.pluginManager?.executeHookSafe('onBeforeDelete', context);

        const { sql, params } = SQLTranslator.buildDeleteQuery(
            this.collectionSchema.name,
            id
        );
        await this.driver.exec(sql, params);

        // Plugin hook: after delete
        const resultContext = {
            ...context,
            result: { id, deleted: true },
        };
        await this.pluginManager?.executeHookSafe('onAfterDelete', resultContext);

        return true;
    }

    async deleteBulk(ids: string[]): Promise<number> {
        let count = 0;
        for (const id of ids) {
            if (await this.delete(id)) count++;
        }
        return count;
    }
    async upsert(
        id: string,
        doc: Omit<InferSchema<T>, 'id'>
    ): Promise<InferSchema<T>> {
        // Use the optimized SQL-level upsert for best performance
        return this.upsertOptimized(id, doc);
    }

    // Add an even more optimized version using SQL UPSERT
    async upsertOptimized(
        id: string,
        doc: Omit<InferSchema<T>, 'id'>
    ): Promise<InferSchema<T>> {
        const fullDoc = { ...doc, id };
        const validatedDoc = this.validateDocument(fullDoc);

        // For maximum performance, use SQL-level UPSERT (INSERT OR REPLACE)
        // This eliminates the need for existence checks entirely
        try {
            // Constraints are now enforced at the SQL level via constrainedFields

            // Use INSERT OR REPLACE for atomic upsert
            if (
                !this.collectionSchema.constrainedFields ||
                Object.keys(this.collectionSchema.constrainedFields).length ===
                    0
            ) {
                // Original behavior for collections without constrained fields
                const sql = `INSERT OR REPLACE INTO ${this.collectionSchema.name} (_id, doc) VALUES (?, ?)`;
                const params = [id, JSON.stringify(validatedDoc)];
                await this.driver.exec(sql, params);
            } else {
                // Build upsert with constrained field columns
                const { sql, params } = SQLTranslator.buildInsertQuery(
                    this.collectionSchema.name,
                    validatedDoc,
                    id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );
                // Convert INSERT to INSERT OR REPLACE
                const upsertSQL = sql.replace(
                    'INSERT INTO',
                    'INSERT OR REPLACE INTO'
                );
                await this.driver.exec(upsertSQL, params);
            }

            return validatedDoc;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    // Extract field name from SQLite error message
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        id
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    async upsertBulk(
        updates: { id: string; doc: Omit<InferSchema<T>, 'id'> }[]
    ): Promise<InferSchema<T>[]> {
        if (updates.length === 0) return [];

        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'upsertBulk',
            data: updates,
        };

        await this.pluginManager?.executeHookSafe('onBeforeInsert', context);

        try {
            const validatedDocs: InferSchema<T>[] = [];
            const sqlParts: string[] = [];
            const allParams: any[] = [];

            for (const update of updates) {
                const fullDoc = { ...update.doc, id: update.id };
                const validatedDoc = this.validateDocument(fullDoc);
                validatedDocs.push(validatedDoc);

                if (
                    !this.collectionSchema.constrainedFields ||
                    Object.keys(this.collectionSchema.constrainedFields).length === 0
                ) {
                    const valuePart = `(?, ?)`;
                    sqlParts.push(valuePart);
                    allParams.push(update.id, JSON.stringify(validatedDoc));
                } else {
                    const { sql, params } = SQLTranslator.buildInsertQuery(
                        this.collectionSchema.name,
                        validatedDoc,
                        update.id,
                        this.collectionSchema.constrainedFields,
                        this.collectionSchema.schema
                    );

                    const valuePart = sql.substring(sql.indexOf('VALUES ') + 7);
                    sqlParts.push(valuePart);
                    allParams.push(...params);
                }
            }

            let batchSQL: string;
            if (
                !this.collectionSchema.constrainedFields ||
                Object.keys(this.collectionSchema.constrainedFields).length === 0
            ) {
                batchSQL = `INSERT OR REPLACE INTO ${this.collectionSchema.name} (_id, doc) VALUES ${sqlParts.join(', ')}`;
            } else {
                const firstQuery = SQLTranslator.buildInsertQuery(
                    this.collectionSchema.name,
                    validatedDocs[0],
                    updates[0].id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );
                const baseSQL = firstQuery.sql.substring(0, firstQuery.sql.indexOf('VALUES ') + 7);
                batchSQL = baseSQL.replace('INSERT INTO', 'INSERT OR REPLACE INTO') + sqlParts.join(', ');
            }

            await this.driver.exec(batchSQL, allParams);

            const resultContext = { ...context, result: validatedDocs };
            await this.pluginManager?.executeHookSafe('onAfterInsert', resultContext);

            return validatedDocs;
        } catch (error) {
            const errorContext = { ...context, error: error as Error };
            await this.pluginManager?.executeHookSafe('onError', errorContext);

            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    async findById(id: string): Promise<InferSchema<T> | null> {
        await this.ensureInitialized();
        const sql = `SELECT doc FROM ${this.collectionSchema.name} WHERE _id = ?`;
        const params = [id];
        const rows = await this.driver.query(sql, params);
        if (rows.length === 0) return null;
        return parseDoc(rows[0].doc);
    }

    private validateFieldName(fieldName: string): void {
        // Skip validation for nested field paths (containing dots)
        // These are handled at the SQL level with json_extract
        if (fieldName.includes('.')) {
            return;
        }

        // Get field names from Zod schema shape
        const schema = this.collectionSchema.schema as any;
        let validFields: string[] = [];

        // Try to get fields from shape property (for ZodObject)
        if (schema.shape) {
            validFields = Object.keys(schema.shape);
        } else if (schema._def && schema._def.shape) {
            validFields = Object.keys(schema._def.shape);
        } else if (schema._def && typeof schema._def.shape === 'function') {
            validFields = Object.keys(schema._def.shape());
        }

        // Only validate if we successfully extracted field names
        if (validFields.length > 0 && !validFields.includes(fieldName)) {
            throw new ValidationError(
                `Field '${fieldName}' does not exist in schema. Valid fields: ${validFields.join(
                    ', '
                )}`
            );
        }

        // If we can't determine valid fields, don't validate (backward compatibility)
    }

    where<K extends QueryablePaths<InferSchema<T>>>(
        field: K
    ): import('./query-builder.js').FieldBuilder<InferSchema<T>, K> & {
        collection: Collection<T>;
    };
    where(field: string): import('./query-builder.js').FieldBuilder<
        InferSchema<T>,
        any
    > & {
        collection: Collection<T>;
    };
    where<K extends QueryablePaths<InferSchema<T>>>(
        field: K | string
    ): import('./query-builder.js').FieldBuilder<InferSchema<T>, K> & {
        collection: Collection<T>;
    } {
        // Validate field name exists in schema
        this.validateFieldName(field as string);

        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        const fieldBuilder = builder.where(field as K);
        (fieldBuilder as any).collection = this;
        return fieldBuilder as import('./query-builder.js').FieldBuilder<
            InferSchema<T>,
            K
        > & { collection: Collection<T> };
    }

    // Query method that returns a QueryBuilder for complex queries
    query(): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder;
    }

    // Direct query methods without conditions
    async toArray(): Promise<InferSchema<T>[]> {
        // Plugin hook: before query
        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'query',
            data: { filters: [] },
        };
        await this.pluginManager?.executeHookSafe('onBeforeQuery', context);

        const { sql, params } = SQLTranslator.buildSelectQuery(
            this.collectionSchema.name,
            { filters: [] },
            this.collectionSchema.constrainedFields
        );
        const rows = await this.driver.query(sql, params);
        const results = rows.map((row) => parseDoc(row.doc));

        // Plugin hook: after query
        const resultContext = {
            ...context,
            result: results,
        };
        await this.pluginManager?.executeHookSafe('onAfterQuery', resultContext);

        return results;
    }

    // Add direct sorting and pagination methods to Collection
    orderBy<K extends OrderablePaths<InferSchema<T>>>(
        field: K,
        direction?: 'asc' | 'desc'
    ): QueryBuilder<InferSchema<T>>;
    orderBy(
        field: string,
        direction?: 'asc' | 'desc'
    ): QueryBuilder<InferSchema<T>>;
    orderBy<K extends OrderablePaths<InferSchema<T>>>(
        field: K | string,
        direction: 'asc' | 'desc' = 'asc'
    ): QueryBuilder<InferSchema<T>> {
        // Validate field name exists in schema
        this.validateFieldName(field as string);

        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.orderBy(field as K, direction);
    }

    limit(count: number): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.limit(count);
    }

    offset(count: number): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.offset(count);
    }

    page(pageNumber: number, pageSize: number): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.page(pageNumber, pageSize);
    }

    distinct(): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.distinct();
    }

    orderByMultiple(
        orders: { field: keyof InferSchema<T>; direction?: 'asc' | 'desc' }[]
    ): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.orderByMultiple(orders);
    }

    or(
        builderFn: (
            builder: QueryBuilder<InferSchema<T>>
        ) => QueryBuilder<InferSchema<T>>
    ): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.or(builderFn);
    }

    // Async versions of direct collection query methods
    async orderByAsync<K extends OrderablePaths<InferSchema<T>>>(
        field: K | string,
        direction: 'asc' | 'desc' = 'asc'
    ): Promise<QueryBuilder<InferSchema<T>>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.orderBy(field as K, direction);
    }

    async limitAsync(count: number): Promise<QueryBuilder<InferSchema<T>>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.limit(count);
    }

    async offsetAsync(count: number): Promise<QueryBuilder<InferSchema<T>>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.offset(count);
    }

    // Add sync versions for backward compatibility
    insertSync(doc: Omit<InferSchema<T>, 'id'>): InferSchema<T> {
        const context = {
            collectionName: this.collectionSchema.name,
            schema: this.collectionSchema,
            operation: 'insert',
            data: doc,
        };

        // Note: Plugin hooks are async, so we can't properly await them in sync mode
        this.pluginManager
            ?.executeHookSafe('onBeforeInsert', context)
            .catch(console.warn);

        try {
            const docWithPossibleId = doc as any;
            let id: string;

            if (docWithPossibleId.id) {
                id = docWithPossibleId.id;
                const existing = this.findByIdSync(id);
                if (existing) {
                    throw new UniqueConstraintError(
                        `Document with id '${id}' already exists`,
                        'id'
                    );
                }
            } else {
                id = this.generateId();
            }

            const fullDoc = { ...doc, id };
            const validatedDoc = this.validateDocument(fullDoc);

            const { sql, params } = SQLTranslator.buildInsertQuery(
                this.collectionSchema.name,
                validatedDoc,
                id,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );
            this.driver.execSync(sql, params);

            const resultContext = { ...context, result: validatedDoc };
            this.pluginManager
                ?.executeHookSafe('onAfterInsert', resultContext)
                .catch(console.warn);

            return validatedDoc;
        } catch (error) {
            const errorContext = { ...context, error: error as Error };
            this.pluginManager
                ?.executeHookSafe('onError', errorContext)
                .catch(console.warn);

            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    // Extract field name from SQLite error message
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        (doc as any).id || 'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    insertBulkSync(docs: Omit<InferSchema<T>, 'id'>[]): InferSchema<T>[] {
        if (docs.length === 0) return [];

        try {
            const validatedDocs: InferSchema<T>[] = [];
            const sqlParts: string[] = [];
            const allParams: any[] = [];

            for (const doc of docs) {
                const docWithPossibleId = doc as any;
                let id: string;

                if (docWithPossibleId.id) {
                    id = docWithPossibleId.id;
                    const existing = this.findByIdSync(id);
                    if (existing) {
                        throw new UniqueConstraintError(
                            `Document with id '${id}' already exists`,
                            'id'
                        );
                    }
                } else {
                    id = this.generateId();
                }

                const fullDoc = { ...doc, id };
                const validatedDoc = this.validateDocument(fullDoc);
                validatedDocs.push(validatedDoc);

                const { sql, params } = SQLTranslator.buildInsertQuery(
                    this.collectionSchema.name,
                    validatedDoc,
                    id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );

                const valuePart = sql.substring(sql.indexOf('VALUES ') + 7);
                sqlParts.push(valuePart);
                allParams.push(...params);
            }

            const firstQuery = SQLTranslator.buildInsertQuery(
                this.collectionSchema.name,
                validatedDocs[0],
                (validatedDocs[0] as any).id,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );
            const baseSQL = firstQuery.sql.substring(0, firstQuery.sql.indexOf('VALUES ') + 7);
            const batchSQL = baseSQL + sqlParts.join(', ');

            this.driver.execSync(batchSQL, allParams);
            return validatedDocs;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    findByIdSync(id: string): InferSchema<T> | null {
        if (!this.collectionSchema.constrainedFields || Object.keys(this.collectionSchema.constrainedFields).length === 0) {
            // Original behavior for collections without constrained fields
            const sql = `SELECT doc FROM ${this.collectionSchema.name} WHERE _id = ?`;
            const params = [id];
            const rows = this.driver.querySync(sql, params);
            if (rows.length === 0) return null;
            return parseDoc(rows[0].doc);
        }

        // For collections with constrained fields, select both doc and constrained columns
        const constrainedFieldColumns = Object.keys(this.collectionSchema.constrainedFields).join(', ');
        const sql = `SELECT doc, ${constrainedFieldColumns} FROM ${this.collectionSchema.name} WHERE _id = ?`;
        const params = [id];
        const rows = this.driver.querySync(sql, params);
        if (rows.length === 0) return null;
        return mergeConstrainedFields(rows[0], this.collectionSchema.constrainedFields);
    }

    toArraySync(): InferSchema<T>[] {
        const { sql, params } = SQLTranslator.buildSelectQuery(
            this.collectionSchema.name,
            { filters: [] },
            this.collectionSchema.constrainedFields
        );
        const rows = this.driver.querySync(sql, params);
        return rows.map((row) => parseDoc(row.doc));
    }

    countSync(): number {
        const sql = `SELECT COUNT(*) as count FROM ${this.collectionSchema.name}`;
        const result = this.driver.querySync(sql, []);
        return result[0].count;
    }

    firstSync(): InferSchema<T> | null {
        const { sql, params } = SQLTranslator.buildSelectQuery(
            this.collectionSchema.name,
            { filters: [], limit: 1 },
            this.collectionSchema.constrainedFields
        );
        const rows = this.driver.querySync(sql, params);
        return rows.length > 0 ? parseDoc(rows[0].doc) : null;
    }

    putSync(id: string, doc: Partial<InferSchema<T>>): InferSchema<T> {
        const existing = this.findByIdSync(id);
        if (!existing) {
            throw new NotFoundError('Document not found', id);
        }

        const updatedDoc = { ...existing, ...doc, id };
        const validatedDoc = this.validateDocument(updatedDoc);

        try {
            const { sql, params } = SQLTranslator.buildUpdateQuery(
                this.collectionSchema.name,
                validatedDoc,
                id,
                this.collectionSchema.constrainedFields,
                this.collectionSchema.schema
            );
            this.driver.execSync(sql, params);
            return validatedDoc;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    // Extract field name from SQLite error message
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        id
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    deleteSync(id: string): boolean {
        const { sql, params } = SQLTranslator.buildDeleteQuery(
            this.collectionSchema.name,
            id
        );
        this.driver.execSync(sql, params);
        return true;
    }

    deleteBulkSync(ids: string[]): number {
        let count = 0;
        for (const id of ids) {
            if (this.deleteSync(id)) count++;
        }
        return count;
    }

    upsertSync(id: string, doc: Omit<InferSchema<T>, 'id'>): InferSchema<T> {
        try {
            const existing = this.findByIdSync(id);
            if (existing) {
                return this.putSync(id, doc as Partial<InferSchema<T>>);
            } else {
                return this.insertSync({ ...doc, id } as any);
            }
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    // Extract field name from SQLite error message
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        id
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    upsertBulkSync(
        docs: { id: string; doc: Omit<InferSchema<T>, 'id'> }[]
    ): InferSchema<T>[] {
        if (docs.length === 0) return [];

        try {
            const validatedDocs: InferSchema<T>[] = [];
            const sqlParts: string[] = [];
            const allParams: any[] = [];

            for (const item of docs) {
                const fullDoc = { ...item.doc, id: item.id };
                const validatedDoc = this.validateDocument(fullDoc);
                validatedDocs.push(validatedDoc);

                if (
                    !this.collectionSchema.constrainedFields ||
                    Object.keys(this.collectionSchema.constrainedFields).length === 0
                ) {
                    const valuePart = `(?, ?)`;
                    sqlParts.push(valuePart);
                    allParams.push(item.id, JSON.stringify(validatedDoc));
                } else {
                    const { sql, params } = SQLTranslator.buildInsertQuery(
                        this.collectionSchema.name,
                        validatedDoc,
                        item.id,
                        this.collectionSchema.constrainedFields,
                        this.collectionSchema.schema
                    );

                    const valuePart = sql.substring(sql.indexOf('VALUES ') + 7);
                    sqlParts.push(valuePart);
                    allParams.push(...params);
                }
            }

            let batchSQL: string;
            if (
                !this.collectionSchema.constrainedFields ||
                Object.keys(this.collectionSchema.constrainedFields).length === 0
            ) {
                batchSQL = `INSERT OR REPLACE INTO ${this.collectionSchema.name} (_id, doc) VALUES ${sqlParts.join(', ')}`;
            } else {
                const firstQuery = SQLTranslator.buildInsertQuery(
                    this.collectionSchema.name,
                    validatedDocs[0],
                    docs[0].id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );
                const baseSQL = firstQuery.sql.substring(0, firstQuery.sql.indexOf('VALUES ') + 7);
                batchSQL = baseSQL.replace('INSERT INTO', 'INSERT OR REPLACE INTO') + sqlParts.join(', ');
            }

            this.driver.execSync(batchSQL, allParams);
            return validatedDocs;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    putBulkSync(
        updates: { id: string; doc: Partial<InferSchema<T>> }[]
    ): InferSchema<T>[] {
        if (updates.length === 0) return [];

        try {
            const validatedDocs: InferSchema<T>[] = [];
            const sqlStatements: { sql: string; params: any[] }[] = [];

            for (const update of updates) {
                const existing = this.findByIdSync(update.id);
                if (!existing) {
                    throw new NotFoundError('Document not found', update.id);
                }

                const updatedDoc = { ...existing, ...update.doc, id: update.id };
                const validatedDoc = this.validateDocument(updatedDoc);
                validatedDocs.push(validatedDoc);

                const { sql, params } = SQLTranslator.buildUpdateQuery(
                    this.collectionSchema.name,
                    validatedDoc,
                    update.id,
                    this.collectionSchema.constrainedFields,
                    this.collectionSchema.schema
                );
                sqlStatements.push({ sql, params });
            }

            this.driver.execSync('BEGIN TRANSACTION', []);
            try {
                for (const statement of sqlStatements) {
                    this.driver.execSync(statement.sql, statement.params);
                }
                this.driver.execSync('COMMIT', []);
            } catch (error) {
                this.driver.execSync('ROLLBACK', []);
                throw error;
            }

            return validatedDocs;
        } catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('UNIQUE constraint')) {
                    const fieldMatch = error.message.match(
                        /UNIQUE constraint failed: [^.]+\.([^,\s]+)/
                    );
                    const field = fieldMatch ? fieldMatch[1] : 'unknown';
                    throw new UniqueConstraintError(
                        `Document violates unique constraint on field: ${field}`,
                        'unknown'
                    );
                } else if (error.message.includes('FOREIGN KEY constraint')) {
                    throw new ValidationError(
                        'Document validation failed: Invalid foreign key reference',
                        error
                    );
                }
            }
            throw error;
        }
    }

    // Add count and first methods to Collection (async by default)
    async count(): Promise<number> {
        const sql = `SELECT COUNT(*) as count FROM ${this.collectionSchema.name}`;
        const result = await this.driver.query(sql, []);
        return result[0].count;
    }

    async first(): Promise<InferSchema<T> | null> {
        const { sql, params } = SQLTranslator.buildSelectQuery(
            this.collectionSchema.name,
            { filters: [], limit: 1 },
            this.collectionSchema.constrainedFields
        );
        const rows = await this.driver.query(sql, params);
        return rows.length > 0 ? parseDoc(rows[0].doc) : null;
    }
}

// Extend QueryBuilder to support collection operations
declare module './query-builder.js' {
    interface QueryBuilder<T> {
        // Default async methods
        toArray(): Promise<T[]>;
        exec(): Promise<T[]>; // Alias for toArray
        first(): Promise<T | null>;
        executeCount(): Promise<number>; // Renamed to avoid conflict with count aggregate method
        // Sync versions for backward compatibility
        toArraySync(): T[];
        firstSync(): T | null;
        countSync(): number;
    }

    interface FieldBuilder<T, K extends QueryablePaths<T> | string> {
        // Default async methods
        toArray(): Promise<T[]>;
        exec(): Promise<T[]>; // Alias for toArray
        first(): Promise<T | null>;
        executeCount(): Promise<number>;
        // Sync versions for backward compatibility
        toArraySync(): T[];
        firstSync(): T | null;
        countSync(): number;
    }
}

QueryBuilder.prototype.toArray = async function <T>(
    this: QueryBuilder<T> & { collection?: Collection<any> }
): Promise<T[]> {
    if (!this.collection)
        throw new Error('Collection not bound to query builder');

    const { sql, params } = SQLTranslator.buildSelectQuery(
        this.collection['collectionSchema'].name,
        this.getOptions(),
        this.collection['collectionSchema'].constrainedFields
    );
    const rows = await this.collection['driver'].query(sql, params);
    
    // Check if this is an aggregate query
    const options = this.getOptions();
    if (options.aggregates && options.aggregates.length > 0) {
        // For aggregate queries, return the raw results without parsing doc
        return rows as T[];
    }
    
    // Check if this is a JOIN query
    if (options.joins && options.joins.length > 0) {
        // For JOIN queries, merge data from multiple tables into JSON objects
        return rows.map(row => {
            const mergedObject: any = {};
            
            // Parse the main table's doc if it exists
            if (row.doc) {
                Object.assign(mergedObject, parseDoc(row.doc));
            }
            
            // Add any direct column values (non-JSON fields) from SELECT
            Object.keys(row).forEach(key => {
                if (key !== 'doc' && row[key] !== null && row[key] !== undefined) {
                    // Handle table-prefixed field names like "users.name" -> "name"
                    const fieldName = key.includes('.') ? key.split('.').pop() : key;
                    if (fieldName) {
                        mergedObject[fieldName] = row[key];
                    }
                }
            });
            
            return mergedObject;
        }) as T[];
    }
    
    return rows.map((row) => parseDoc(row.doc));
};

// Add exec as alias for toArray
QueryBuilder.prototype.exec = QueryBuilder.prototype.toArray;

QueryBuilder.prototype.first = async function <T>(
    this: QueryBuilder<T>
): Promise<T | null> {
    const results = await this.limit(1).toArray();
    return results[0] || null;
};

QueryBuilder.prototype.executeCount = async function <T>(
    this: QueryBuilder<T> & { collection?: Collection<any> }
): Promise<number> {
    if (!this.collection)
        throw new Error('Collection not bound to query builder');

    const options = this.getOptions();
    let sql = `SELECT COUNT(*) as count FROM ${this.collection['collectionSchema'].name}`;
    const params: any[] = [];

    if (options.filters.length > 0) {
        const { whereClause, whereParams } = SQLTranslator.buildWhereClause(
            options.filters,
            'AND',
            this.collection['collectionSchema'].constrainedFields
        );
        sql += ` WHERE ${whereClause}`;
        params.push(...whereParams);
    }

    const result = await this.collection['driver'].query(sql, params);
    return result[0].count;
};

// Add sync versions for backward compatibility
QueryBuilder.prototype.toArraySync = function <T>(
    this: QueryBuilder<T> & { collection?: Collection<any> }
): T[] {
    if (!this.collection)
        throw new Error('Collection not bound to query builder');

    const { sql, params } = SQLTranslator.buildSelectQuery(
        this.collection['collectionSchema'].name,
        this.getOptions(),
        this.collection['collectionSchema'].constrainedFields
    );
    const rows = this.collection['driver'].querySync(sql, params);
    
    // Check if this is an aggregate query
    const options = this.getOptions();
    if (options.aggregates && options.aggregates.length > 0) {
        // For aggregate queries, return the raw results without parsing doc
        return rows as T[];
    }
    
    // Check if this is a JOIN query
    if (options.joins && options.joins.length > 0) {
        // For JOIN queries, merge data from multiple tables into JSON objects
        return rows.map(row => {
            const mergedObject: any = {};
            
            // Parse the main table's doc if it exists
            if (row.doc) {
                Object.assign(mergedObject, parseDoc(row.doc));
            }
            
            // Add any direct column values (non-JSON fields) from SELECT
            Object.keys(row).forEach(key => {
                if (key !== 'doc' && row[key] !== null && row[key] !== undefined) {
                    // Handle table-prefixed field names like "users.name" -> "name"
                    const fieldName = key.includes('.') ? key.split('.').pop() : key;
                    if (fieldName) {
                        mergedObject[fieldName] = row[key];
                    }
                }
            });
            
            return mergedObject;
        }) as T[];
    }
    
    return rows.map((row) => parseDoc(row.doc));
};

QueryBuilder.prototype.firstSync = function <T>(
    this: QueryBuilder<T>
): T | null {
    const results = this.limit(1).toArraySync();
    return results[0] || null;
};

QueryBuilder.prototype.countSync = function <T>(
    this: QueryBuilder<T> & { collection?: Collection<any> }
): number {
    if (!this.collection)
        throw new Error('Collection not bound to query builder');

    const options = this.getOptions();
    let sql = `SELECT COUNT(*) as count FROM ${this.collection['collectionSchema'].name}`;
    const params: any[] = [];

    if (options.filters.length > 0) {
        const { whereClause, whereParams } = SQLTranslator.buildWhereClause(
            options.filters,
            'AND',
            this.collection['collectionSchema'].constrainedFields
        );
        sql += ` WHERE ${whereClause}`;
        params.push(...whereParams);
    }

    const result = this.collection['driver'].querySync(sql, params);
    return result[0].count;
};

// FieldBuilder methods (async by default)
FieldBuilder.prototype.toArray = async function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): Promise<T[]> {
    throw new Error(
        'toArray() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.exec = async function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): Promise<T[]> {
    throw new Error(
        'exec() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.first = async function <T>(
    this: FieldBuilder<T, any>
): Promise<T | null> {
    throw new Error(
        'first() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.executeCount = async function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): Promise<number> {
    throw new Error(
        'executeCount() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

// FieldBuilder sync methods
FieldBuilder.prototype.toArraySync = function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): T[] {
    throw new Error(
        'toArraySync() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.firstSync = function <T>(
    this: FieldBuilder<T, any>
): T | null {
    throw new Error(
        'firstSync() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.countSync = function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): number {
    throw new Error(
        'countSync() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};
