import type {
    Constraint,
    IndexDefinition,
    SchemaConstraints,
    UniqueConstraint,
    ForeignKeyConstraint,
    CheckConstraint,
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
            // Add field-level constraints
            if (constraints.constraints) {
                for (const [fieldName, constraint] of Object.entries(
                    constraints.constraints
                )) {
                    const constraintArray = Array.isArray(constraint)
                        ? constraint
                        : [constraint];

                    for (const c of constraintArray) {
                        if (c.type === 'unique') {
                            // Create unique constraint on JSON field
                            const constraintName =
                                c.name || `${tableName}_${fieldName}_unique`;
                            additionalSQL.push(
                                `CREATE UNIQUE INDEX IF NOT EXISTS ${constraintName} ON ${tableName} (json_extract(doc, '$.${fieldName}'))`
                            );
                        } else if (c.type === 'foreign_key') {
                            // Note: SQLite doesn't support foreign keys on JSON fields directly
                            // We'll need to handle this at the application level
                            console.warn(
                                `Foreign key constraint on JSON field '${fieldName}' will be enforced at application level`
                            );
                        } else if (c.type === 'check') {
                            // Add check constraint using JSON extraction
                            const constraintName =
                                c.name || `${tableName}_${fieldName}_check`;
                            // Replace field name with json_extract, handling word boundaries
                            const expression = c.expression.replace(
                                new RegExp(`\\b${fieldName}\\b`, 'g'),
                                `json_extract(doc, '$.${fieldName}')`
                            );
                            sql += `,\n  CONSTRAINT ${constraintName} CHECK (${expression})`;
                        }
                    }
                }
            }

            // Add table-level constraints
            if (constraints.tableLevelConstraints) {
                for (const constraint of constraints.tableLevelConstraints) {
                    if (constraint.type === 'unique') {
                        // For unique constraints on JSON fields, create unique indexes instead
                        const uniqueConstraint = constraint as UniqueConstraint;
                        const indexName = uniqueConstraint.name || 
                            `${tableName}_unique_${uniqueConstraint.fields.join('_')}`;
                        const fields = uniqueConstraint.fields
                            .map((f) => `json_extract(doc, '$.${f}')`)
                            .join(', ');
                        additionalSQL.push(
                            `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${fields})`
                        );
                    } else {
                        const constraintSQL = this.buildConstraintSQL(constraint, tableName);
                        if (constraintSQL) {
                            sql += `,\n  ${constraintSQL}`;
                        }
                    }
                }
            }

            // Add indexes
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
     * Build constraint SQL for table-level constraints
     */
    private static buildConstraintSQL(
        constraint: Constraint,
        tableName: string
    ): string {
        switch (constraint.type) {
            case 'unique':
                const uniqueConstraint = constraint as UniqueConstraint;
                const uniqueName =
                    uniqueConstraint.name ||
                    `${tableName}_unique_${uniqueConstraint.fields.join('_')}`;
                const uniqueFields = uniqueConstraint.fields
                    .map((f) => `json_extract(doc, '$.${f}')`)
                    .join(', ');
                return `CONSTRAINT ${uniqueName} UNIQUE (${uniqueFields})`;

            case 'foreign_key':
                // Table-level foreign keys on JSON fields not directly supported
                console.warn(
                    'Table-level foreign key constraints on JSON fields will be enforced at application level'
                );
                return '';

            case 'check':
                const checkConstraint = constraint as CheckConstraint;
                const checkName = checkConstraint.name || `${tableName}_check`;
                return `CONSTRAINT ${checkName} CHECK (${checkConstraint.expression})`;

            default:
                return '';
        }
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
     * Validate foreign key constraints at application level
     */
    static validateForeignKeyConstraints(
        doc: any,
        constraints: SchemaConstraints | undefined,
        checkFunction: (
            table: string,
            field: string,
            value: any
        ) => Promise<boolean>
    ): Promise<string[]> {
        const errors: string[] = [];

        if (!constraints?.constraints) return Promise.resolve(errors);

        const validationPromises = Object.entries(constraints.constraints).map(
            async ([fieldName, constraint]) => {
                const constraintArray = Array.isArray(constraint)
                    ? constraint
                    : [constraint];

                for (const c of constraintArray) {
                    if (c.type === 'foreign_key') {
                        const fkConstraint = c as ForeignKeyConstraint;
                        const fieldValue = doc[fieldName];

                        if (fieldValue !== null && fieldValue !== undefined) {
                            const exists = await checkFunction(
                                fkConstraint.referencedTable,
                                fkConstraint.referencedFields[0],
                                fieldValue
                            );

                            if (!exists) {
                                errors.push(
                                    `Foreign key constraint violation: ${fieldName} references non-existent ${fkConstraint.referencedTable}.${fkConstraint.referencedFields[0]}`
                                );
                            }
                        }
                    }
                }
            }
        );

        return Promise.all(validationPromises).then(() => errors);
    }

    /**
     * Check if a value violates unique constraints
     */
    static buildUniqueCheckQuery(
        tableName: string,
        fieldName: string,
        value: any,
        excludeId?: string
    ): { sql: string; params: any[] } {
        let sql = `SELECT COUNT(*) as count FROM ${tableName} WHERE json_extract(doc, '$.${fieldName}') = ?`;
        const params = [value];

        if (excludeId) {
            sql += ` AND _id != ?`;
            params.push(excludeId);
        }

        return { sql, params };
    }

    /**
     * Check if values violate composite unique constraints
     */
    static buildCompositeUniqueCheckQuery(
        tableName: string,
        fields: string[],
        values: any[],
        excludeId?: string
    ): { sql: string; params: any[] } {
        const whereConditions = fields.map(
            (field) => `json_extract(doc, '$.${field}') = ?`
        );
        let sql = `SELECT COUNT(*) as count FROM ${tableName} WHERE ${whereConditions.join(
            ' AND '
        )}`;
        const params = [...values];

        if (excludeId) {
            sql += ` AND _id != ?`;
            params.push(excludeId);
        }

        return { sql, params };
    }

    /**
     * Check if a referenced value exists for foreign key validation
     */
    static buildForeignKeyCheckQuery(
        referencedTable: string,
        referencedField: string,
        value: any
    ): { sql: string; params: any[] } {
        const sql = `SELECT COUNT(*) as count FROM ${referencedTable} WHERE json_extract(doc, '$.${referencedField}') = ?`;
        const params = [value];

        return { sql, params };
    }

    /**
     * Build cascading delete queries for foreign key constraints
     */
    static buildCascadeDeleteQueries(
        constraints: SchemaConstraints | undefined,
        tableName: string,
        deletedId: string
    ): Array<{ sql: string; params: any[] }> {
        const queries: Array<{ sql: string; params: any[] }> = [];

        // This would need to be expanded to handle the full constraint system
        // For now, we return an empty array as a placeholder
        return queries;
    }
}
