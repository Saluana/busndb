import type { QueryOptions, QueryFilter, QueryGroup } from './types.js';
import { stringifyDoc } from './json-utils.js';

export class SQLTranslator {
  static buildSelectQuery(tableName: string, options: QueryOptions): { sql: string; params: any[] } {
    let sql = options.distinct ? `SELECT DISTINCT doc FROM ${tableName}` : `SELECT doc FROM ${tableName}`;
    const params: any[] = [];

    if (options.filters.length > 0) {
      const { whereClause, whereParams } = this.buildWhereClause(options.filters);
      sql += ` WHERE ${whereClause}`;
      params.push(...whereParams);
    }

    if (options.groupBy && options.groupBy.length > 0) {
      const groupClauses = options.groupBy.map(field => 
        `json_extract(doc, '$.${field}')`
      );
      sql += ` GROUP BY ${groupClauses.join(', ')}`;
    }

    if (options.orderBy && options.orderBy.length > 0) {
      const orderClauses = options.orderBy.map(order => 
        `json_extract(doc, '$.${order.field}') ${order.direction.toUpperCase()}`
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

  static buildInsertQuery(tableName: string, doc: any, id: string): { sql: string; params: any[] } {
    const sql = `INSERT INTO ${tableName} (id, doc) VALUES (?, ?)`;
    return { sql, params: [id, stringifyDoc(doc)] };
  }

  static buildUpdateQuery(tableName: string, doc: any, id: string): { sql: string; params: any[] } {
    const sql = `UPDATE ${tableName} SET doc = ? WHERE id = ?`;
    return { sql, params: [stringifyDoc(doc), id] };
  }

  static buildDeleteQuery(tableName: string, id: string): { sql: string; params: any[] } {
    const sql = `DELETE FROM ${tableName} WHERE id = ?`;
    return { sql, params: [id] };
  }

  static buildCreateTableQuery(tableName: string): string {
    return `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      doc TEXT NOT NULL
    )`;
  }

  static buildWhereClause(filters: (QueryFilter | QueryGroup)[]): { whereClause: string; whereParams: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    for (const filterOrGroup of filters) {
      if ('type' in filterOrGroup) {
        // Handle QueryGroup (OR/AND)
        const group = filterOrGroup as QueryGroup;
        const operator = group.type.toUpperCase();
        const groupConditions: string[] = [];
        
        for (const filter of group.filters) {
          if ('type' in filter) {
            // Nested group
            const { whereClause: nestedClause, whereParams: nestedParams } = this.buildWhereClause([filter]);
            if (nestedClause) {
              groupConditions.push(`(${nestedClause})`);
              params.push(...nestedParams);
            }
          } else {
            // Individual filter
            const { whereClause: filterClause, whereParams: filterParams } = this.buildFilterClause(filter as QueryFilter);
            if (filterClause) {
              groupConditions.push(filterClause);
              params.push(...filterParams);
            }
          }
        }
        
        if (groupConditions.length > 0) {
          clauses.push(`(${groupConditions.join(` ${operator} `)})`);
        }
      } else {
        // Handle individual QueryFilter
        const filter = filterOrGroup as QueryFilter;
        const { whereClause: filterClause, whereParams: filterParams } = this.buildFilterClause(filter);
        
        if (filterClause) {
          clauses.push(filterClause);
          params.push(...filterParams);
        }
      }
    }

    return {
      whereClause: clauses.join(' AND '),
      whereParams: params
    };
  }

  private static buildFilterClause(filter: QueryFilter): { whereClause: string; whereParams: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];
    const fieldPath = `json_extract(doc, '$.${filter.field}')`;
    
    switch (filter.operator) {
      case 'eq':
        clauses.push(`${fieldPath} = ?`);
        params.push(filter.value);
        break;
      case 'neq':
        clauses.push(`${fieldPath} != ?`);
        params.push(filter.value);
        break;
      case 'gt':
        clauses.push(`${fieldPath} > ?`);
        params.push(filter.value);
        break;
      case 'gte':
        clauses.push(`${fieldPath} >= ?`);
        params.push(filter.value);
        break;
      case 'lt':
        clauses.push(`${fieldPath} < ?`);
        params.push(filter.value);
        break;
      case 'lte':
        clauses.push(`${fieldPath} <= ?`);
        params.push(filter.value);
        break;
      case 'between':
        clauses.push(`${fieldPath} BETWEEN ? AND ?`);
        params.push(filter.value, filter.value2);
        break;
      case 'in':
        const placeholders = filter.value.map(() => '?').join(', ');
        clauses.push(`${fieldPath} IN (${placeholders})`);
        params.push(...filter.value);
        break;
      case 'nin':
        const ninPlaceholders = filter.value.map(() => '?').join(', ');
        clauses.push(`${fieldPath} NOT IN (${ninPlaceholders})`);
        params.push(...filter.value);
        break;
      case 'like':
        clauses.push(`${fieldPath} LIKE ?`);
        params.push(filter.value);
        break;
      case 'ilike':
        clauses.push(`UPPER(${fieldPath}) LIKE UPPER(?)`);
        params.push(filter.value);
        break;
      case 'startswith':
        clauses.push(`${fieldPath} LIKE ?`);
        params.push(`${filter.value}%`);
        break;
      case 'endswith':
        clauses.push(`${fieldPath} LIKE ?`);
        params.push(`%${filter.value}`);
        break;
      case 'contains':
        clauses.push(`${fieldPath} LIKE ?`);
        params.push(`%${filter.value}%`);
        break;
      case 'exists':
        if (filter.value) {
          clauses.push(`${fieldPath} IS NOT NULL`);
        } else {
          clauses.push(`${fieldPath} IS NULL`);
        }
        break;
    }

    return {
      whereClause: clauses.join(' AND '),
      whereParams: params
    };
  }
}