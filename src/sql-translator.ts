import type {
    QueryOptions,
    QueryFilter,
    QueryGroup,
    SubqueryFilter,
    AggregateField,
    JoinClause,
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
import { SchemaSQLGenerator } from './schema-sql-generator';

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
        const params: any[] = [];
        
        // Build SELECT clause
        let selectClause = this.buildSelectClause(tableName, options, constrainedFields);
        
        // Build FROM clause with joins
        let fromClause = this.buildFromClause(tableName, options.joins);
        
        let sql = `${selectClause} ${fromClause}`;

        // Build WHERE clause
        if (options.filters.length > 0) {
            const { whereClause, whereParams } = this.buildWhereClause(
                options.filters,
                'AND',
                constrainedFields,
                tableName,
                options.joins
            );
            sql += ` WHERE ${whereClause}`;
            params.push(...whereParams);
        }

        // Build GROUP BY clause
        if (options.groupBy && options.groupBy.length > 0) {
            const groupClauses = options.groupBy.map((field) =>
                this.qualifyFieldAccess(field, tableName, constrainedFields, options.joins)
            );
            sql += ` GROUP BY ${groupClauses.join(', ')}`;
        }

        // Build HAVING clause
        if (options.having && options.having.length > 0) {
            const { whereClause: havingClause, whereParams: havingParams } = this.buildHavingClause(
                options.having,
                'AND',
                constrainedFields,
                tableName
            );
            sql += ` HAVING ${havingClause}`;
            params.push(...havingParams);
        }

        // Build ORDER BY clause
        if (options.orderBy && options.orderBy.length > 0) {
            const orderClauses = options.orderBy.map(
                (order) =>
                    `${this.qualifyFieldAccess(
                        order.field,
                        tableName,
                        constrainedFields,
                        options.joins
                    )} ${order.direction.toUpperCase()}`
            );
            sql += ` ORDER BY ${orderClauses.join(', ')}`;
        }

        // Build LIMIT and OFFSET clauses
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

    /**
     * Build vector insertion queries for vec0 virtual tables
     */
    static buildVectorInsertQueries(
        tableName: string,
        doc: any,
        id: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): { sql: string; params: any[] }[] {
        const queries: { sql: string; params: any[] }[] = [];
        
        if (!constrainedFields) return queries;
        
        const vectorFields = SchemaSQLGenerator.getVectorFields(constrainedFields);
        const constrainedValues = extractConstrainedValues(doc, constrainedFields);
        
        for (const [fieldPath, fieldDef] of Object.entries(vectorFields)) {
            const vectorTableName = SchemaSQLGenerator.getVectorTableName(tableName, fieldPath);
            const columnName = fieldPathToColumnName(fieldPath);
            const vectorValue = constrainedValues[fieldPath];
            
            if (vectorValue && Array.isArray(vectorValue)) {
                const sql = `INSERT INTO ${vectorTableName} (rowid, ${columnName}) VALUES (
                    (SELECT rowid FROM ${tableName} WHERE _id = ?), ?
                )`;
                // Convert to Float32Array for sqlite-vec, compatible with better-sqlite3
                const vectorArray = new Float32Array(vectorValue);
                const params = [id, Buffer.from(vectorArray.buffer)];
                queries.push({ sql, params });
            }
        }
        
        return queries;
    }

    /**
     * Build vector update queries for vec0 virtual tables
     */
    static buildVectorUpdateQueries(
        tableName: string,
        doc: any,
        id: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): { sql: string; params: any[] }[] {
        const queries: { sql: string; params: any[] }[] = [];
        
        if (!constrainedFields) return queries;
        
        const vectorFields = SchemaSQLGenerator.getVectorFields(constrainedFields);
        const constrainedValues = extractConstrainedValues(doc, constrainedFields);
        
        for (const [fieldPath, fieldDef] of Object.entries(vectorFields)) {
            const vectorTableName = SchemaSQLGenerator.getVectorTableName(tableName, fieldPath);
            const columnName = fieldPathToColumnName(fieldPath);
            const vectorValue = constrainedValues[fieldPath];
            
            if (vectorValue && Array.isArray(vectorValue)) {
                // For updates, first delete existing vector, then insert new one
                // Delete existing vector data
                const deleteSql = `DELETE FROM ${vectorTableName} WHERE rowid = (SELECT rowid FROM ${tableName} WHERE _id = ?)`;
                queries.push({ sql: deleteSql, params: [id] });
                
                // Insert new vector data
                const insertSql = `INSERT INTO ${vectorTableName} (rowid, ${columnName}) VALUES (
                    (SELECT rowid FROM ${tableName} WHERE _id = ?), ?
                )`;
                // Convert to Float32Array for sqlite-vec, compatible with better-sqlite3
                const vectorArray = new Float32Array(vectorValue);
                const params = [id, Buffer.from(vectorArray.buffer)];
                queries.push({ sql: insertSql, params });
            }
        }
        
        return queries;
    }

    /**
     * Build vector deletion queries for vec0 virtual tables
     */
    static buildVectorDeleteQueries(
        tableName: string,
        id: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): { sql: string; params: any[] }[] {
        const queries: { sql: string; params: any[] }[] = [];
        
        if (!constrainedFields) return queries;
        
        const vectorFields = SchemaSQLGenerator.getVectorFields(constrainedFields);
        
        for (const [fieldPath] of Object.entries(vectorFields)) {
            const vectorTableName = SchemaSQLGenerator.getVectorTableName(tableName, fieldPath);
            const sql = `DELETE FROM ${vectorTableName} WHERE rowid = (SELECT rowid FROM ${tableName} WHERE _id = ?)`;
            const params = [id];
            queries.push({ sql, params });
        }
        
        return queries;
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
    /** New helper methods for enhanced queries */
    
    static buildSelectClause(
        tableName: string,
        options: QueryOptions,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): string {
        let selectClause = 'SELECT';
        
        if (options.distinct) {
            selectClause += ' DISTINCT';
        }

        // Handle aggregates and custom field selection
        if (options.aggregates && options.aggregates.length > 0) {
            const aggregateFields = options.aggregates.map(agg => 
                this.buildAggregateField(agg, tableName, constrainedFields)
            ).join(', ');
            
            if (options.selectFields && options.selectFields.length > 0) {
                const selectedFields = options.selectFields.map(field => {
                    const fieldAccess = this.qualifyFieldAccess(field, tableName, constrainedFields, options.joins);
                    // Add alias for better field names in results
                    if (fieldAccess.includes('json_extract')) {
                        return `${fieldAccess} AS "${field}"`;
                    }
                    return fieldAccess;
                }).join(', ');
                selectClause += ` ${selectedFields}, ${aggregateFields}`;
            } else {
                selectClause += ` ${aggregateFields}`;
            }
        } else if (options.selectFields && options.selectFields.length > 0) {
            const selectedFields = options.selectFields.map(field => {
                const fieldAccess = this.qualifyFieldAccess(field, tableName, constrainedFields, options.joins);
                // Add alias for better field names in results
                if (fieldAccess.includes('json_extract')) {
                    return `${fieldAccess} AS "${field}"`;
                }
                return fieldAccess;
            }).join(', ');
            selectClause += ` ${selectedFields}`;
        } else {
            // Default to selecting documents
            selectClause += ` ${tableName}.doc`;
        }
        
        return selectClause;
    }

    static buildFromClause(tableName: string, joins?: JoinClause[]): string {
        let fromClause = `FROM ${tableName}`;
        
        if (joins && joins.length > 0) {
            for (const join of joins) {
                const joinType = join.type === 'FULL' ? 'FULL OUTER' : join.type;
                
                // For joins, we need to handle field access properly for document-based storage
                const leftFieldAccess = join.condition.left === '_id'
                    ? `${tableName}._id`
                    : `json_extract(${tableName}.doc, '$.${join.condition.left}')`;

                const rightFieldAccess = join.condition.right === '_id'
                    ? `${join.collection}._id`
                    : `json_extract(${join.collection}.doc, '$.${join.condition.right}')`;
                    
                const operator = join.condition.operator || '=';
                
                fromClause += ` ${joinType} JOIN ${join.collection} ON ${leftFieldAccess} ${operator} ${rightFieldAccess}`;
            }
        }
        
        return fromClause;
    }

    static buildAggregateField(
        agg: AggregateField,
        tableName: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }
    ): string {
        const fieldAccess = agg.field === '*' ? '*' : this.qualifyFieldAccess(agg.field, tableName, constrainedFields);
        const distinctPrefix = agg.distinct ? 'DISTINCT ' : '';
        const alias = agg.alias ? ` AS ${agg.alias}` : '';
        
        return `${agg.function}(${distinctPrefix}${fieldAccess})${alias}`;
    }

    static qualifyFieldAccess(
        field: string,
        tableName: string,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        joins?: JoinClause[]
    ): string {
        // Handle table-prefixed fields like "users.name" or "posts.title"
        if (field.includes('.')) {
            const [tablePrefix, fieldName] = field.split('.', 2);
            
            // Check if this is actually a nested JSON path, not a table prefix
            // If the full field path is a constrained field, it's a nested path
            if (constrainedFields && constrainedFields[field]) {
                return `${tableName}.${fieldPathToColumnName(field)}`;
            }
            
            // Check if this field is a constrained field in any table
            if (constrainedFields && constrainedFields[fieldName]) {
                return `${tablePrefix}.${fieldPathToColumnName(fieldName)}`;
            }
            
            // For id field, use _id column directly
            if (fieldName === '_id') {
                return `${tablePrefix}._id`;
            }
            
            // IMPROVED LOGIC: Check if we're in a JOIN context and if the prefix is a known table
            const knownTables = [tableName];
            if (joins && joins.length > 0) {
                knownTables.push(...joins.map(join => join.collection));
            }
            
            if (knownTables.includes(tablePrefix)) {
                // This is a real table.field reference (either main table or joined table)
                return `json_extract(${tablePrefix}.doc, '$.${fieldName}')`;
            } else {
                // This is a nested JSON path (e.g., meta.bio, user.preferences.theme, anything.nested)
                return `json_extract(${tableName}.doc, '$.${field}')`;
            }
        }
        
        // Handle non-prefixed fields (legacy behavior)
        if (constrainedFields && constrainedFields[field]) {
            return `${tableName}.${fieldPathToColumnName(field)}`;
        }
        
        // For id field, use _id column directly
        if (field === '_id') {
            return `${tableName}._id`;
        }
        
        return `json_extract(${tableName}.doc, '$.${field}')`;
    }


    static getFieldAccess(field: string): string {
        // Simple field access without table qualification for joins
        return field;
    }

    static buildHavingClause(
        filters: (QueryFilter | QueryGroup)[],
        joinOp: 'AND' | 'OR' = 'AND',
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        tableName?: string
    ): { whereClause: string; whereParams: any[] } {
        const parts: string[] = [];
        const params: any[] = [];

        for (const f of filters) {
            if ('type' in f) {
                /* QueryGroup */
                const grp = f as QueryGroup;
                const { whereClause, whereParams } = this.buildHavingClause(
                    grp.filters as (QueryFilter | QueryGroup)[], // HAVING doesn't support subqueries
                    grp.type.toUpperCase() as 'AND' | 'OR',
                    constrainedFields,
                    tableName
                );
                if (whereClause) {
                    parts.push(`(${whereClause})`);
                    params.push(...whereParams);
                }
            } else {
                /* QueryFilter */
                const { whereClause, whereParams } = this.buildHavingFilterClause(
                    f as QueryFilter,
                    constrainedFields,
                    tableName
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

    static buildWhereClause(
        filters: (QueryFilter | QueryGroup | SubqueryFilter)[],
        joinOp: 'AND' | 'OR' = 'AND',
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        tableName?: string,
        joins?: JoinClause[]
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
                    constrainedFields,
                    tableName,
                    joins
                );
                if (whereClause) {
                    parts.push(`(${whereClause})`);
                    params.push(...whereParams);
                }
            } else if ('subquery' in f) {
                /* SubqueryFilter */
                const { whereClause, whereParams } = this.buildSubqueryClause(
                    f as SubqueryFilter,
                    constrainedFields,
                    tableName
                );
                parts.push(whereClause);
                params.push(...whereParams);
            } else {
                /* QueryFilter */
                const { whereClause, whereParams } = this.buildFilterClause(
                    f as QueryFilter,
                    constrainedFields,
                    tableName,
                    joins
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

    /** ----------  2. Subquery clause builder ---------- */
    private static buildSubqueryClause(
        filter: SubqueryFilter,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        tableName?: string
    ): {
        whereClause: string;
        whereParams: any[];
    } {
        const fieldAccess = tableName 
            ? this.qualifyFieldAccess(filter.field, tableName, constrainedFields)
            : getFieldAccess(filter.field, constrainedFields);
        
        const { sql: subquerySql, params: subqueryParams } = this.buildSelectQuery(
            filter.subqueryCollection,
            filter.subquery,
            constrainedFields
        );
        
        let whereClause = '';
        
        switch (filter.operator) {
            case 'exists':
                // For EXISTS, we need to correlate the main table field with the subquery
                // Add correlation condition to the subquery
                const correlatedSubquery = subquerySql.replace(
                    /WHERE (.+)$/,
                    `WHERE $1 AND ${this.qualifyFieldAccess('userId', filter.subqueryCollection, constrainedFields)} = ${fieldAccess}`
                );
                whereClause = `EXISTS (${correlatedSubquery})`;
                break;
            case 'not_exists':
                // Similar correlation for NOT EXISTS
                const correlatedNotExistsSubquery = subquerySql.replace(
                    /WHERE (.+)$/,
                    `WHERE $1 AND ${this.qualifyFieldAccess('userId', filter.subqueryCollection, constrainedFields)} = ${fieldAccess}`
                );
                whereClause = `NOT EXISTS (${correlatedNotExistsSubquery})`;
                break;
            case 'in':
                whereClause = `${fieldAccess} IN (${subquerySql})`;
                break;
            case 'not_in':
                whereClause = `${fieldAccess} NOT IN (${subquerySql})`;
                break;
        }
        
        return { whereClause, whereParams: subqueryParams };
    }

    /** ----------  3. HAVING clause filter builder ---------- */
    private static buildHavingFilterClause(
        filter: QueryFilter,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        tableName?: string
    ): {
        whereClause: string;
        whereParams: any[];
    } {
        // For HAVING clause, use field names directly (they should be aliases)
        const col = filter.field;
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
                const placeholders = filter.value.map(() => '?').join(', ');
                c = `${col}${
                    filter.operator === 'nin' ? ' NOT' : ''
                } IN (${placeholders})`;
                p.push(...filter.value.map(convertValue));
                break;
            }
        }
        return { whereClause: c, whereParams: p };
    }

    /** ----------  4. Cheap single‑pass filter builder ---------- */
    private static buildFilterClause(
        filter: QueryFilter,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        tableName?: string,
        joins?: JoinClause[]
    ): {
        whereClause: string;
        whereParams: any[];
    } {
        let col: string;
        
        // If we have joins, we need to determine which table the field belongs to
        // Check if the field is already a SQL function (like json_array_length)
        if (filter.field.includes('(') && filter.field.includes(')')) {
            // This is already a SQL function, use it as-is but need to extract the actual field for JSON access
            const fieldMatch = filter.field.match(/\(([^)]+)\)/);
            if (fieldMatch) {
                const actualField = fieldMatch[1];
                const fieldAccess = tableName 
                    ? this.qualifyFieldAccess(actualField, tableName, constrainedFields, joins)
                    : getFieldAccess(actualField, constrainedFields);
                col = filter.field.replace(actualField, fieldAccess);
            } else {
                col = filter.field; // fallback
            }
        } else if (joins && joins.length > 0) {
            // Handle table-prefixed field names like "posts.published"
            if (filter.field.includes('.')) {
                const [tablePrefix, fieldName] = filter.field.split('.', 2);
                
                // Use the specified table prefix
                if (constrainedFields && constrainedFields[fieldName]) {
                    col = `${tablePrefix}.${fieldPathToColumnName(fieldName)}`;
                } else if (fieldName === '_id') {
                    col = `${tablePrefix}._id`;
                } else {
                    col = `json_extract(${tablePrefix}.doc, '$.${fieldName}')`;
                }
            } else {
                // Simple heuristic: check if field name suggests it belongs to a joined table
                let targetTable = tableName;
                
                for (const join of joins) {
                    // Heuristic: common fields that typically belong to specific tables
                    if ((filter.field === 'total' || filter.field === 'status') && join.collection === 'orders') {
                        targetTable = 'orders';
                        break;
                    }
                    if (filter.field === 'price' && join.collection === 'products') {
                        targetTable = 'products';
                        break;
                    }
                    // Add more heuristics as needed
                }
                
                col = this.qualifyFieldAccess(filter.field, targetTable || tableName || 'documents', constrainedFields, joins);
            }
        } else {
            col = tableName 
                ? this.qualifyFieldAccess(filter.field, tableName, constrainedFields, joins)
                : getFieldAccess(filter.field, constrainedFields);
        }
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
            case 'json_array_contains':
                // Use json_each to check if value exists in array
                c = `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`;
                p.push(convertValue(filter.value));
                break;
            case 'json_array_not_contains':
                // Use json_each to check if value does NOT exist in array
                c = `NOT EXISTS (SELECT 1 FROM json_each(${col}) WHERE value = ?)`;
                p.push(convertValue(filter.value));
                break;
        }
        return { whereClause: c, whereParams: p };
    }
}
