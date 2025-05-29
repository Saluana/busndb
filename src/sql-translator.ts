import type {
    QueryOptions,
    QueryFilter,
    QueryGroup,
    ConstrainedFieldDefinition,
} from './types';
import { stringifyDoc } from './json-utils';
import {
    extractConstrainedValues,
    fieldPathToColumnName,
    convertValueForStorage,
    inferSQLiteType,
    getZodTypeForPath,
} from './constrained-fields';

/**
 * Small helper: cache `"json_extract(doc,'$.field')"` strings so we build
 * each unique path exactly once per process.
 */
const jsonPathCache = new Map<string, string>();
const jsonPath = (field: string) => {
    let cached = jsonPathCache.get(field);
    if (!cached) {
        cached = `json_extract(doc, '$.${field}')`;
        jsonPathCache.set(field, cached);
    }
    return cached;
};

/**
 * Choose optimal field access method based on whether field is constrained
 */
const getFieldAccess = (
    field: string,
    constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
): string => {
    if (constrainedFields && constrainedFields[field]) {
        // Use dedicated column for constrained fields
        return fieldPathToColumnName(field);
    }
    // Use JSON extraction for non-constrained fields
    return jsonPath(field);
};

export class SQLTranslator {
    /* ░░░░░░ unchanged buildSelect / buildInsert / buildUpdate / buildDelete ░░░░░░ */

    static buildSelectQuery(
        tableName: string,
        options: QueryOptions,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): { sql: string; params: any[] } {
        let sql = options.distinct
            ? `SELECT DISTINCT doc FROM ${tableName}`
            : `SELECT doc FROM ${tableName}`;
        const params: any[] = [];

        if (options.filters.length > 0) {
            const { whereClause, whereParams } = this.buildWhereClause(
                options.filters,
                'AND',
                constrainedFields
            );
            sql += ` WHERE ${whereClause}`;
            params.push(...whereParams);
        }

        if (options.groupBy && options.groupBy.length > 0) {
            const groupClauses = options.groupBy.map((field) =>
                getFieldAccess(field, constrainedFields)
            );
            sql += ` GROUP BY ${groupClauses.join(', ')}`;
        }

        if (options.orderBy && options.orderBy.length > 0) {
            const orderClauses = options.orderBy.map(
                (order) =>
                    `${getFieldAccess(
                        order.field,
                        constrainedFields
                    )} ${order.direction.toUpperCase()}`
            );
            sql += ` ORDER BY ${orderClauses.join(', ')}`;
        }

        if (options.limit) {
            sql += ` LIMIT ?`;
            params.push(options.limit);

            if (options.offset) {
                sql += ` OFFSET ?`;
                params.push(options.offset);
            }
        } else if (options.offset) {
            // SQLite requires LIMIT when using OFFSET, so we use a very large limit
            sql += ` LIMIT ? OFFSET ?`;
            params.push(Number.MAX_SAFE_INTEGER, options.offset);
        }

        return { sql, params };
    }

    static buildInsertQuery(
        tableName: string,
        doc: any,
        id: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        schema?: any
    ): { sql: string; params: any[] } {
        if (!constrainedFields || Object.keys(constrainedFields).length === 0) {
            // Original behavior for collections without constrained fields
            const sql = `INSERT INTO ${tableName} (_id, doc) VALUES (?, ?)`;
            return { sql, params: [id, stringifyDoc(doc)] };
        }

        // Build insert with constrained field columns
        const columns = ['_id', 'doc'];
        const params: any[] = [id, stringifyDoc(doc)];

        const constrainedValues = extractConstrainedValues(
            doc,
            constrainedFields
        );

        for (const [fieldPath, fieldDef] of Object.entries(constrainedFields)) {
            const columnName = fieldPathToColumnName(fieldPath);
            const value = constrainedValues[fieldPath];

            // Infer SQLite type for proper value conversion
            const zodType = schema
                ? getZodTypeForPath(schema, fieldPath)
                : null;
            const sqliteType = zodType
                ? inferSQLiteType(zodType, fieldDef)
                : 'TEXT';

            columns.push(columnName);
            params.push(convertValueForStorage(value, sqliteType));
        }

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${tableName} (${columns.join(
            ', '
        )}) VALUES (${placeholders})`;

        return { sql, params };
    }

    static buildUpdateQuery(
        tableName: string,
        doc: any,
        id: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        schema?: any
    ): { sql: string; params: any[] } {
        if (!constrainedFields || Object.keys(constrainedFields).length === 0) {
            // Original behavior for collections without constrained fields
            const sql = `UPDATE ${tableName} SET doc = ? WHERE _id = ?`;
            return { sql, params: [stringifyDoc(doc), id] };
        }

        // Build update with constrained field columns
        const setClauses = ['doc = ?'];
        const params: any[] = [stringifyDoc(doc)];

        const constrainedValues = extractConstrainedValues(
            doc,
            constrainedFields
        );

        for (const [fieldPath, fieldDef] of Object.entries(constrainedFields)) {
            const columnName = fieldPathToColumnName(fieldPath);
            const value = constrainedValues[fieldPath];

            // Infer SQLite type for proper value conversion
            const zodType = schema
                ? getZodTypeForPath(schema, fieldPath)
                : null;
            const sqliteType = zodType
                ? inferSQLiteType(zodType, fieldDef)
                : 'TEXT';

            setClauses.push(`${columnName} = ?`);
            params.push(convertValueForStorage(value, sqliteType));
        }

        params.push(id); // WHERE clause parameter
        const sql = `UPDATE ${tableName} SET ${setClauses.join(
            ', '
        )} WHERE _id = ?`;

        return { sql, params };
    }

    static buildDeleteQuery(
        tableName: string,
        id: string
    ): { sql: string; params: any[] } {
        const sql = `DELETE FROM ${tableName} WHERE _id = ?`;
        return { sql, params: [id] };
    }

    static buildCreateTableQuery(tableName: string): string {
        return `CREATE TABLE IF NOT EXISTS ${tableName} (
      _id TEXT PRIMARY KEY,
      doc TEXT NOT NULL
    )`;
    }

    /** ----------  1. **O(n)** WHERE‑clause builder  ---------- */
    static buildWhereClause(
        filters: (QueryFilter | QueryGroup)[],
        joinOp: 'AND' | 'OR' = 'AND',
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): { whereClause: string; whereParams: any[] } {
        const parts: string[] = [];
        const params: any[] = [];

        for (const f of filters) {
            if ('type' in f) {
                /* QueryGroup */
                const grp = f as QueryGroup;
                const { whereClause, whereParams } = this.buildWhereClause(
                    grp.filters,
                    grp.type.toUpperCase() as 'AND' | 'OR',
                    constrainedFields
                );
                if (whereClause) {
                    parts.push(`(${whereClause})`);
                    params.push(...whereParams);
                }
            } else {
                /* QueryFilter */
                const { whereClause, whereParams } = this.buildFilterClause(
                    f as QueryFilter,
                    constrainedFields
                );
                parts.push(whereClause);
                params.push(...whereParams);
            }
        }
        return {
            whereClause: parts.join(` ${joinOp} `),
            whereParams: params,
        };
    }

    /** ----------  2. Cheap single‑pass filter builder ---------- */
    private static buildFilterClause(
        filter: QueryFilter,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): {
        whereClause: string;
        whereParams: any[];
    } {
        const col = getFieldAccess(filter.field, constrainedFields);
        const p: any[] = [];
        let c = '';

        // Helper function to convert JavaScript values to SQLite-compatible values
        const convertValue = (value: any): any => {
            if (typeof value === 'boolean') {
                return value ? 1 : 0;
            }
            return value;
        };

        switch (filter.operator) {
            case 'eq':
                c = `${col} = ?`;
                p.push(convertValue(filter.value));
                break;
            case 'neq':
                c = `${col} != ?`;
                p.push(convertValue(filter.value));
                break;
            case 'gt':
                c = `${col} > ?`;
                p.push(convertValue(filter.value));
                break;
            case 'gte':
                c = `${col} >= ?`;
                p.push(convertValue(filter.value));
                break;
            case 'lt':
                c = `${col} < ?`;
                p.push(convertValue(filter.value));
                break;
            case 'lte':
                c = `${col} <= ?`;
                p.push(convertValue(filter.value));
                break;
            case 'between':
                c = `${col} BETWEEN ? AND ?`;
                p.push(convertValue(filter.value), convertValue(filter.value2));
                break;
            case 'in':
            case 'nin': {
                /* Match V1 formatting with spaces between placeholders */
                const placeholders = filter.value.map(() => '?').join(', ');
                c = `${col}${
                    filter.operator === 'nin' ? ' NOT' : ''
                } IN (${placeholders})`;
                p.push(...filter.value.map(convertValue));
                break;
            }
            case 'like':
                c = `${col} LIKE ?`;
                p.push(convertValue(filter.value));
                break;
            case 'ilike':
                c = `UPPER(${col}) LIKE UPPER(?)`;
                p.push(convertValue(filter.value));
                break;
            case 'startswith':
                c = `${col} LIKE ?`;
                p.push(`${convertValue(filter.value)}%`);
                break;
            case 'endswith':
                c = `${col} LIKE ?`;
                p.push(`%${convertValue(filter.value)}`);
                break;
            case 'contains':
                c = `${col} LIKE ?`;
                p.push(`%${convertValue(filter.value)}%`);
                break;
            case 'exists':
                c = filter.value ? `${col} IS NOT NULL` : `${col} IS NULL`;
                break;
        }
        return { whereClause: c, whereParams: p };
    }
}
