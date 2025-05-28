import type { QueryOptions, QueryFilter, QueryGroup } from './types.js';
import { stringifyDoc } from './json-utils.js';

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

export class SQLTranslator {
    /* ░░░░░░ unchanged buildSelect / buildInsert / buildUpdate / buildDelete ░░░░░░ */

    static buildSelectQuery(
        tableName: string,
        options: QueryOptions
    ): { sql: string; params: any[] } {
        let sql = options.distinct
            ? `SELECT DISTINCT doc FROM ${tableName}`
            : `SELECT doc FROM ${tableName}`;
        const params: any[] = [];

        if (options.filters.length > 0) {
            const { whereClause, whereParams } = this.buildWhereClause(
                options.filters
            );
            sql += ` WHERE ${whereClause}`;
            params.push(...whereParams);
        }

        if (options.groupBy && options.groupBy.length > 0) {
            const groupClauses = options.groupBy.map(
                (field) => `json_extract(doc, '$.${field}')`
            );
            sql += ` GROUP BY ${groupClauses.join(', ')}`;
        }

        if (options.orderBy && options.orderBy.length > 0) {
            const orderClauses = options.orderBy.map(
                (order) =>
                    `json_extract(doc, '$.${
                        order.field
                    }') ${order.direction.toUpperCase()}`
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
        id: string
    ): { sql: string; params: any[] } {
        const sql = `INSERT INTO ${tableName} (id, doc) VALUES (?, ?)`;
        return { sql, params: [id, stringifyDoc(doc)] };
    }

    static buildUpdateQuery(
        tableName: string,
        doc: any,
        id: string
    ): { sql: string; params: any[] } {
        const sql = `UPDATE ${tableName} SET doc = ? WHERE id = ?`;
        return { sql, params: [stringifyDoc(doc), id] };
    }

    static buildDeleteQuery(
        tableName: string,
        id: string
    ): { sql: string; params: any[] } {
        const sql = `DELETE FROM ${tableName} WHERE id = ?`;
        return { sql, params: [id] };
    }

    static buildCreateTableQuery(tableName: string): string {
        return `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      doc TEXT NOT NULL
    )`;
    }

    /** ----------  1. **O(n)** WHERE‑clause builder  ---------- */
    static buildWhereClause(
        filters: (QueryFilter | QueryGroup)[],
        joinOp: 'AND' | 'OR' = 'AND'
    ): { whereClause: string; whereParams: any[] } {
        const parts: string[] = [];
        const params: any[] = [];

        for (const f of filters) {
            if ('type' in f) {
                /* QueryGroup */
                const grp = f as QueryGroup;
                const { whereClause, whereParams } = this.buildWhereClause(
                    grp.filters,
                    grp.type.toUpperCase() as 'AND' | 'OR'
                );
                if (whereClause) {
                    parts.push(`(${whereClause})`);
                    params.push(...whereParams);
                }
            } else {
                /* QueryFilter */
                const { whereClause, whereParams } = this.buildFilterClause(
                    f as QueryFilter
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
    private static buildFilterClause(filter: QueryFilter): {
        whereClause: string;
        whereParams: any[];
    } {
        const col = jsonPath(filter.field); // cached string
        const p: any[] = [];
        let c = '';

        switch (filter.operator) {
            case 'eq':
                c = `${col} = ?`;
                p.push(filter.value);
                break;
            case 'neq':
                c = `${col} != ?`;
                p.push(filter.value);
                break;
            case 'gt':
                c = `${col} > ?`;
                p.push(filter.value);
                break;
            case 'gte':
                c = `${col} >= ?`;
                p.push(filter.value);
                break;
            case 'lt':
                c = `${col} < ?`;
                p.push(filter.value);
                break;
            case 'lte':
                c = `${col} <= ?`;
                p.push(filter.value);
                break;
            case 'between':
                c = `${col} BETWEEN ? AND ?`;
                p.push(filter.value, filter.value2);
                break;
            case 'in':
            case 'nin': {
                /* Match V1 formatting with spaces between placeholders */
                const placeholders = filter.value.map(() => '?').join(', ');
                c = `${col}${
                    filter.operator === 'nin' ? ' NOT' : ''
                } IN (${placeholders})`;
                p.push(...filter.value);
                break;
            }
            case 'like':
                c = `${col} LIKE ?`;
                p.push(filter.value);
                break;
            case 'ilike':
                c = `UPPER(${col}) LIKE UPPER(?)`;
                p.push(filter.value);
                break;
            case 'startswith':
                c = `${col} LIKE ?`;
                p.push(`${filter.value}%`);
                break;
            case 'endswith':
                c = `${col} LIKE ?`;
                p.push(`%${filter.value}`);
                break;
            case 'contains':
                c = `${col} LIKE ?`;
                p.push(`%${filter.value}%`);
                break;
            case 'exists':
                c = filter.value ? `${col} IS NOT NULL` : `${col} IS NULL`;
                break;
        }
        return { whereClause: c, whereParams: p };
    }
}
