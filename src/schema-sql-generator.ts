import type {
    IndexDefinition,
    SchemaConstraints,
} from './schema-constraints';
import type { ConstrainedFieldDefinition } from './types';
import { 
    fieldPathToColumnName,
    inferSQLiteType,
    getZodTypeForPath,
    parseForeignKeyReference,
    validateConstrainedFields
} from './constrained-fields';

export class SchemaSQLGenerator {
    /**
     * Generate CREATE TABLE SQL with constraints
     */
    static buildCreateTableWithConstraints(
        tableName: string,
        constraints?: SchemaConstraints,
        constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition },
        schema?: any
    ): { sql: string; additionalSQL: string[] } {
        let sql = `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;
        sql += `  _id TEXT PRIMARY KEY,\n`;
        sql += `  doc TEXT NOT NULL`;

        const additionalSQL: string[] = [];
        const vectorFields: { [fieldPath: string]: ConstrainedFieldDefinition } = {};
        
        // Add constrained field columns
        if (constrainedFields && schema) {
            // Validate constrained fields exist in schema
            const validationErrors = validateConstrainedFields(schema, constrainedFields);
            if (validationErrors.length > 0) {
                throw new Error(`Invalid constrained fields: ${validationErrors.join(', ')}`);
            }
            
            for (const [fieldPath, fieldDef] of Object.entries(constrainedFields)) {
                const columnName = fieldPathToColumnName(fieldPath);
                const zodType = getZodTypeForPath(schema, fieldPath);
                let sqliteType = zodType ? inferSQLiteType(zodType, fieldDef) : 'TEXT';
                
                // Handle vector fields - they need both regular column and vec0 virtual tables
                if (sqliteType === 'VECTOR' || fieldDef.type === 'VECTOR') {
                    vectorFields[fieldPath] = fieldDef;
                    
                    // Validate vector dimensions are specified
                    if (!fieldDef.vectorDimensions) {
                        throw new Error(`Vector field '${fieldPath}' must specify vectorDimensions`);
                    }
                    
                    // Create vec0 virtual table for this vector field
                    const vectorType = fieldDef.vectorType || 'float';
                    const vectorTableName = `${tableName}_${columnName}_vec`;
                    
                    additionalSQL.push(
                        `CREATE VIRTUAL TABLE IF NOT EXISTS ${vectorTableName} USING vec0(${columnName} ${vectorType}[${fieldDef.vectorDimensions}])`
                    );
                    
                    // Continue to create regular column for JSON storage - don't skip
                    // Set sqliteType to TEXT for the regular column
                    sqliteType = 'TEXT';
                }
                
                // Build column definition for non-vector fields
                let columnDef = `${columnName} ${sqliteType}`;
                
                // Add NOT NULL if not nullable (default is nullable for constrained fields)
                if (fieldDef.nullable === false) {
                    columnDef += ' NOT NULL';
                }
                
                // Add UNIQUE constraint
                if (fieldDef.unique) {
                    columnDef += ' UNIQUE';
                }
                
                // Add foreign key constraint
                if (fieldDef.foreignKey) {
                    const fkRef = parseForeignKeyReference(fieldDef.foreignKey);
                    if (fkRef) {
                        // Expect foreign keys to reference the '_id' primary key column
                        const actualColumn = fkRef.column === 'id' ? '_id' : fkRef.column;
                        columnDef += ` REFERENCES ${fkRef.table}(${actualColumn})`;
                        
                        if (fieldDef.onDelete) {
                            columnDef += ` ON DELETE ${fieldDef.onDelete}`;
                        }
                        
                        if (fieldDef.onUpdate) {
                            columnDef += ` ON UPDATE ${fieldDef.onUpdate}`;
                        }
                    }
                }
                
                // Add check constraint
                if (fieldDef.checkConstraint) {
                    columnDef += ` CHECK (${fieldDef.checkConstraint.replace(new RegExp(`\\b${fieldPath}\\b`, 'g'), columnName)})`;
                }
                
                sql += `,\n  ${columnDef}`;
            }
        }

        if (constraints) {
            // Add indexes only (constraints now handled via constrainedFields)
            // Note: SchemaConstraints is deprecated - only indexes are processed
            if (constraints.indexes) {
                for (const [indexName, indexDef] of Object.entries(
                    constraints.indexes
                )) {
                    additionalSQL.push(
                        this.buildIndexSQL(indexName, indexDef, tableName)
                    );
                }
            }
        }

        sql += `\n)`;

        return { sql, additionalSQL };
    }


    /**
     * Build index SQL
     */
    private static buildIndexSQL(
        indexName: string,
        indexDef: IndexDefinition,
        tableName: string
    ): string {
        const uniqueKeyword = indexDef.unique ? 'UNIQUE ' : '';
        const fields = indexDef.fields
            .map((f) => `json_extract(doc, '$.${f}')`)
            .join(', ');
        const whereClause = indexDef.partial
            ? ` WHERE ${indexDef.partial}`
            : '';

        return `CREATE ${uniqueKeyword}INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${fields})${whereClause}`;
    }

    /**
     * Get vector table name for a field
     */
    static getVectorTableName(tableName: string, fieldPath: string): string {
        const columnName = fieldPathToColumnName(fieldPath);
        return `${tableName}_${columnName}_vec`;
    }

    /**
     * Get all vector fields from constrained fields
     */
    static getVectorFields(constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition }): { [fieldPath: string]: ConstrainedFieldDefinition } {
        if (!constrainedFields) return {};
        
        const vectorFields: { [fieldPath: string]: ConstrainedFieldDefinition } = {};
        for (const [fieldPath, fieldDef] of Object.entries(constrainedFields)) {
            if (fieldDef.type === 'VECTOR') {
                vectorFields[fieldPath] = fieldDef;
            }
        }
        
        return vectorFields;
    }





}
