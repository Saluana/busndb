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
                const sqliteType = zodType ? inferSQLiteType(zodType, fieldDef) : 'TEXT';
                
                // Build column definition
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
                        columnDef += ` REFERENCES ${fkRef.table}(${fkRef.column})`;
                        
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





}
