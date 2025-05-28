import { z } from 'zod';
import type { Driver, CollectionSchema, InferSchema } from './types';
import { QueryBuilder, FieldBuilder } from './query-builder';
import { SQLTranslator } from './sql-translator';
import { SchemaSQLGenerator } from './schema-sql-generator.js';
import type { ForeignKeyConstraint } from './schema-constraints.js';
import {
    ValidationError,
    NotFoundError,
    UniqueConstraintError,
} from './errors.js';
import { parseDoc } from './json-utils.js';
import type { QueryablePaths, OrderablePaths } from './types/nested-paths';

export class Collection<T extends z.ZodSchema> {
    private driver: Driver;
    private collectionSchema: CollectionSchema<InferSchema<T>>;

    constructor(driver: Driver, schema: CollectionSchema<InferSchema<T>>) {
        this.driver = driver;
        this.collectionSchema = schema;
        this.createTable();
    }

    private createTable(): void {
        const { sql, additionalSQL } =
            SchemaSQLGenerator.buildCreateTableWithConstraints(
                this.collectionSchema.name,
                this.collectionSchema.constraints
            );

        this.driver.exec(sql);

        // Execute additional SQL for indexes and constraints
        for (const additionalQuery of additionalSQL) {
            this.driver.exec(additionalQuery);
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

    private validateUniqueConstraints(
        doc: InferSchema<T>,
        excludeId?: string
    ): void {
        if (!this.collectionSchema.constraints?.constraints) return;

        for (const [fieldName, constraint] of Object.entries(
            this.collectionSchema.constraints.constraints
        )) {
            const constraintArray = Array.isArray(constraint)
                ? constraint
                : [constraint];

            for (const c of constraintArray) {
                if (c.type === 'unique') {
                    if (c.fields && c.fields.length > 1) {
                        // Composite unique constraint
                        const values = c.fields.map(
                            (field) => (doc as any)[field]
                        );
                        const hasNonNullValues = values.some(
                            (v) => v !== null && v !== undefined
                        );

                        if (hasNonNullValues) {
                            const { sql, params } =
                                SchemaSQLGenerator.buildCompositeUniqueCheckQuery(
                                    this.collectionSchema.name,
                                    c.fields,
                                    values,
                                    excludeId
                                );

                            const result = this.driver.query(sql, params);
                            if (result[0].count > 0) {
                                throw new UniqueConstraintError(
                                    `Composite unique constraint violation: ${c.fields.join(
                                        ', '
                                    )} combination already exists`,
                                    c.fields.join('_')
                                );
                            }
                        }
                    } else {
                        // Single field unique constraint
                        const fieldValue = (doc as any)[fieldName];
                        if (fieldValue !== null && fieldValue !== undefined) {
                            const { sql, params } =
                                SchemaSQLGenerator.buildUniqueCheckQuery(
                                    this.collectionSchema.name,
                                    fieldName,
                                    fieldValue,
                                    excludeId
                                );

                            const result = this.driver.query(sql, params);
                            if (result[0].count > 0) {
                                throw new UniqueConstraintError(
                                    `Unique constraint violation: ${fieldName} value '${fieldValue}' already exists`,
                                    fieldName
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    private validateForeignKeyConstraints(doc: InferSchema<T>): void {
        if (!this.collectionSchema.constraints?.constraints) return;

        for (const [fieldName, constraint] of Object.entries(
            this.collectionSchema.constraints.constraints
        )) {
            const constraintArray = Array.isArray(constraint)
                ? constraint
                : [constraint];

            for (const c of constraintArray) {
                if (c.type === 'foreign_key') {
                    const fkConstraint = c as ForeignKeyConstraint;
                    const fieldValue = (doc as any)[fieldName];

                    if (fieldValue !== null && fieldValue !== undefined) {
                        const { sql, params } =
                            SchemaSQLGenerator.buildForeignKeyCheckQuery(
                                fkConstraint.referencedTable,
                                fkConstraint.referencedFields[0],
                                fieldValue
                            );

                        const result = this.driver.query(sql, params);
                        if (result[0].count === 0) {
                            throw new ValidationError(
                                `Foreign key constraint violation: ${fieldName} references non-existent ${fkConstraint.referencedTable}.${fkConstraint.referencedFields[0]}`
                            );
                        }
                    }
                }
            }
        }
    }

    insert(doc: Omit<InferSchema<T>, 'id'>): InferSchema<T> {
        // Check if id is provided in doc (via type assertion)
        const docWithPossibleId = doc as any;
        let id: string;

        if (docWithPossibleId.id) {
            // If id is provided, validate it and check for duplicates
            id = docWithPossibleId.id;

            // Check if this id already exists
            const existing = this.findById(id);
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

        // Check unique constraints before insertion
        this.validateUniqueConstraints(validatedDoc);

        // Check foreign key constraints before insertion
        this.validateForeignKeyConstraints(validatedDoc);

        try {
            const { sql, params } = SQLTranslator.buildInsertQuery(
                this.collectionSchema.name,
                validatedDoc,
                id
            );
            this.driver.exec(sql, params);
            return validatedDoc;
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes('UNIQUE constraint')
            ) {
                throw new UniqueConstraintError(
                    'Document violates unique constraint',
                    id
                );
            }
            throw error;
        }
    }

    insertBulk(docs: Omit<InferSchema<T>, 'id'>[]): InferSchema<T>[] {
        const results: InferSchema<T>[] = [];
        for (const doc of docs) {
            results.push(this.insert(doc));
        }
        return results;
    }

    put(id: string, doc: Partial<InferSchema<T>>): InferSchema<T> {
        const existing = this.findById(id);
        if (!existing) {
            throw new NotFoundError('Document not found', id);
        }

        const updatedDoc = { ...existing, ...doc, id };
        const validatedDoc = this.validateDocument(updatedDoc);

        // Check unique constraints before update (excluding current document)
        this.validateUniqueConstraints(validatedDoc, id);

        // Check foreign key constraints before update
        this.validateForeignKeyConstraints(validatedDoc);

        const { sql, params } = SQLTranslator.buildUpdateQuery(
            this.collectionSchema.name,
            validatedDoc,
            id
        );
        this.driver.exec(sql, params);
        return validatedDoc;
    }

    putBulk(
        updates: { id: string; doc: Partial<InferSchema<T>> }[]
    ): InferSchema<T>[] {
        const results: InferSchema<T>[] = [];
        for (const update of updates) {
            results.push(this.put(update.id, update.doc));
        }
        return results;
    }

    delete(id: string): boolean {
        const { sql, params } = SQLTranslator.buildDeleteQuery(
            this.collectionSchema.name,
            id
        );
        this.driver.exec(sql, params);
        return true;
    }

    deleteBulk(ids: string[]): number {
        let count = 0;
        for (const id of ids) {
            if (this.delete(id)) count++;
        }
        return count;
    }
    upsert(id: string, doc: Omit<InferSchema<T>, 'id'>): InferSchema<T> {
        // Use the optimized SQL-level upsert for best performance
        return this.upsertOptimized(id, doc);
    }

    // Add an even more optimized version using SQL UPSERT
    upsertOptimized(
        id: string,
        doc: Omit<InferSchema<T>, 'id'>
    ): InferSchema<T> {
        const fullDoc = { ...doc, id };
        const validatedDoc = this.validateDocument(fullDoc);

        // For maximum performance, use SQL-level UPSERT (INSERT OR REPLACE)
        // This eliminates the need for existence checks entirely
        try {
            // Check constraints before upsert
            this.validateUniqueConstraints(validatedDoc, id);
            this.validateForeignKeyConstraints(validatedDoc);

            // Use INSERT OR REPLACE for atomic upsert
            const sql = `INSERT OR REPLACE INTO ${this.collectionSchema.name} (_id, doc) VALUES (?, ?)`;
            const params = [id, JSON.stringify(validatedDoc)];

            this.driver.exec(sql, params);
            return validatedDoc;
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes('UNIQUE constraint')
            ) {
                throw new UniqueConstraintError(
                    'Document violates unique constraint',
                    id
                );
            }
            throw error;
        }
    }

    upsertBulk(
        updates: { id: string; doc: Omit<InferSchema<T>, 'id'> }[]
    ): InferSchema<T>[] {
        // Use optimized approach for bulk operations
        const results: InferSchema<T>[] = [];
        for (const update of updates) {
            results.push(this.upsertOptimized(update.id, update.doc));
        }
        return results;
    }

    findById(id: string): InferSchema<T> | null {
        const sql = `SELECT doc FROM ${this.collectionSchema.name} WHERE _id = ?`;
        const params = [id];
        const rows = this.driver.query(sql, params);
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

    // Direct query methods without conditions
    toArray(): InferSchema<T>[] {
        const { sql, params } = SQLTranslator.buildSelectQuery(
            this.collectionSchema.name,
            { filters: [] }
        );
        const rows = this.driver.query(sql, params);
        return rows.map((row) => parseDoc(row.doc));
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
}

// Extend QueryBuilder to support collection operations
declare module './query-builder.js' {
    interface QueryBuilder<T> {
        toArray(): T[];
        first(): T | null;
        count(): number;
    }

    interface FieldBuilder<T, K extends QueryablePaths<T> | string> {
        toArray(): T[];
        first(): T | null;
        count(): number;
    }
}

QueryBuilder.prototype.toArray = function <T>(
    this: QueryBuilder<T> & { collection?: Collection<any> }
): T[] {
    if (!this.collection)
        throw new Error('Collection not bound to query builder');

    const { sql, params } = SQLTranslator.buildSelectQuery(
        this.collection['collectionSchema'].name,
        this.getOptions()
    );
    const rows = this.collection['driver'].query(sql, params);
    return rows.map((row) => parseDoc(row.doc));
};

QueryBuilder.prototype.first = function <T>(this: QueryBuilder<T>): T | null {
    const results = this.limit(1).toArray();
    return results[0] || null;
};

QueryBuilder.prototype.count = function <T>(
    this: QueryBuilder<T> & { collection?: Collection<any> }
): number {
    if (!this.collection)
        throw new Error('Collection not bound to query builder');

    const options = this.getOptions();
    let sql = `SELECT COUNT(*) as count FROM ${this.collection['collectionSchema'].name}`;
    const params: any[] = [];

    if (options.filters.length > 0) {
        const { whereClause, whereParams } = SQLTranslator.buildWhereClause(
            options.filters
        );
        sql += ` WHERE ${whereClause}`;
        params.push(...whereParams);
    }

    const result = this.collection['driver'].query(sql, params);
    return result[0].count;
};

// Add prototype methods for FieldBuilder - these are not actually used since FieldBuilder returns QueryBuilder
// but we keep them for type compatibility
FieldBuilder.prototype.toArray = function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): T[] {
    throw new Error(
        'toArray() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.first = function <T>(
    this: FieldBuilder<T, any>
): T | null {
    throw new Error(
        'first() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};

FieldBuilder.prototype.count = function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): number {
    throw new Error(
        'count() should not be called on FieldBuilder. Use a comparison operator first.'
    );
};
