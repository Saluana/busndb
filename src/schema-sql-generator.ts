import type {
    Constraint,
    IndexDefinition,
    SchemaConstraints,
    UniqueConstraint,
    ForeignKeyConstraint,
    CheckConstraint,
} from './schema-constraints';

export class SchemaSQLGenerator {
    /**
     * Generate CREATE TABLE SQL with constraints
     */
    static buildCreateTableWithConstraints(
        tableName: string,
        constraints?: SchemaConstraints
    ): { sql: string; additionalSQL: string[] } {
        let sql = `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;
        sql += `  _id TEXT PRIMARY KEY,\n`;
        sql += `  doc TEXT NOT NULL`;

        const additionalSQL: string[] = [];

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
                    sql += `,\n  ${this.buildConstraintSQL(
                        constraint,
                        tableName
                    )}`;
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
