import { z } from 'zod';
import type { Driver, CollectionSchema, InferSchema } from './types.js';
import { QueryBuilder, FieldBuilder } from './query-builder.js';
import { SQLTranslator } from './sql-translator.js';
import {
    ValidationError,
    NotFoundError,
    UniqueConstraintError,
} from './errors.js';
import { parseDoc } from './json-utils.js';

export class Collection<T extends z.ZodSchema> {
    private driver: Driver;
    private collectionSchema: CollectionSchema<InferSchema<T>>;

    constructor(driver: Driver, schema: CollectionSchema<InferSchema<T>>) {
        this.driver = driver;
        this.collectionSchema = schema;
        this.createTable();
    }

    private createTable(): void {
        const sql = SQLTranslator.buildCreateTableQuery(
            this.collectionSchema.name
        );
        this.driver.exec(sql);
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

    insert(doc: Omit<InferSchema<T>, 'id'>): InferSchema<T> {
        const id = this.generateId();
        const fullDoc = { ...doc, id };
        const validatedDoc = this.validateDocument(fullDoc);

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
                    'Document with this ID already exists',
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

    findById(id: string): InferSchema<T> | null {
        const { sql, params } = SQLTranslator.buildSelectQuery(
            this.collectionSchema.name,
            { filters: [{ field: 'id', operator: 'eq', value: id }] }
        );
        const rows = this.driver.query(sql, params);
        if (rows.length === 0) return null;
        return parseDoc(rows[0].doc);
    }

    where<K extends keyof InferSchema<T>>(
        field: K
    ): import('./query-builder.js').FieldBuilder<InferSchema<T>, K> & {
        collection: Collection<T>;
    } {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        const fieldBuilder = builder.where(field);
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
    orderBy<K extends keyof InferSchema<T>>(field: K, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.orderBy(field, direction);
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

    orderByMultiple(orders: { field: keyof InferSchema<T>; direction?: 'asc' | 'desc' }[]): QueryBuilder<InferSchema<T>> {
        const builder = new QueryBuilder<InferSchema<T>>();
        (builder as any).collection = this;
        return builder.orderByMultiple(orders);
    }

    or(builderFn: (builder: QueryBuilder<InferSchema<T>>) => QueryBuilder<InferSchema<T>>): QueryBuilder<InferSchema<T>> {
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

    interface FieldBuilder<T, K extends keyof T> {
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
    throw new Error('toArray() should not be called on FieldBuilder. Use a comparison operator first.');
};

FieldBuilder.prototype.first = function <T>(
    this: FieldBuilder<T, any>
): T | null {
    throw new Error('first() should not be called on FieldBuilder. Use a comparison operator first.');
};

FieldBuilder.prototype.count = function <T>(
    this: FieldBuilder<T, any> & { collection?: Collection<any> }
): number {
    throw new Error('count() should not be called on FieldBuilder. Use a comparison operator first.');
};
