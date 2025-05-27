import type { QueryOptions, QueryFilter } from './types.js';
import { stringifyDoc } from './json-utils.js';

export class SQLTranslator {
  static buildSelectQuery(tableName: string, options: QueryOptions): { sql: string; params: any[] } {
    let sql = `SELECT doc FROM ${tableName}`;
    const params: any[] = [];

    if (options.filters.length > 0) {
      const { whereClause, whereParams } = this.buildWhereClause(options.filters);
      sql += ` WHERE ${whereClause}`;
      params.push(...whereParams);
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
    }

    if (options.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
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

  static buildWhereClause(filters: QueryFilter[]): { whereClause: string; whereParams: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    for (const filter of filters) {
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
      }
    }

    return {
      whereClause: clauses.join(' AND '),
      whereParams: params
    };
  }
}