import { z } from 'zod';
import type { Driver, CollectionSchema } from './types';
import { DatabaseError } from './errors';

export interface MigrationInfo {
    collectionName: string;
    version: number;
    completedAlters: string[];
}

export interface SchemaDiff {
    alters: string[];
    breaking: boolean;
    breakingReasons: string[];
}

export interface MigrationContext {
    collectionName: string;
    oldVersion: number;
    newVersion: number;
    diff: SchemaDiff;
}

export class Migrator {
    private driver: Driver;
    private static readonly META_TABLE = '_skibbadb_migrations';

    constructor(driver: Driver) {
        this.driver = driver;
    }

    async initializeMigrationsTable(): Promise<void> {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS ${Migrator.META_TABLE} (
                collection_name TEXT PRIMARY KEY,
                version INTEGER NOT NULL,
                completed_alters TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `;
        
        await this.driver.exec(createTableSQL);
    }

    async getStoredVersion(collectionName: string): Promise<number> {
        const sql = `SELECT version FROM ${Migrator.META_TABLE} WHERE collection_name = ?`;
        const rows = await this.driver.query(sql, [collectionName]);
        return rows.length > 0 ? rows[0].version : 0;
    }

    async setStoredVersion(collectionName: string, version: number, completedAlters: string[] = []): Promise<void> {
        const sql = `
            INSERT INTO ${Migrator.META_TABLE} (collection_name, version, completed_alters, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(collection_name) DO UPDATE SET
                version = excluded.version,
                completed_alters = excluded.completed_alters,
                updated_at = excluded.updated_at
        `;
        await this.driver.exec(sql, [collectionName, version, JSON.stringify(completedAlters)]);
    }

    generateSchemaDiff(oldSchema: z.ZodSchema | null, newSchema: z.ZodSchema, tableName: string): SchemaDiff {
        const alters: string[] = [];
        const breakingReasons: string[] = [];
        let breaking = false;

        if (!oldSchema) {
            return { alters: [], breaking: false, breakingReasons: [] };
        }

        const oldShape = this.extractSchemaShape(oldSchema);
        const newShape = this.extractSchemaShape(newSchema);

        if (!oldShape || !newShape) {
            breaking = true;
            breakingReasons.push('Cannot analyze schema shape - manual migration required');
            return { alters, breaking, breakingReasons };
        }

        for (const [fieldName, fieldDef] of Object.entries(newShape)) {
            if (!oldShape[fieldName]) {
                const sqlType = this.zodTypeToSQL(fieldDef);
                const nullable = this.isFieldOptional(fieldDef) ? '' : ' NOT NULL DEFAULT NULL';
                alters.push(`ALTER TABLE ${tableName} ADD COLUMN ${fieldName} ${sqlType}${nullable}`);
            } else {
                const oldType = this.zodTypeToSQL(oldShape[fieldName]);
                const newType = this.zodTypeToSQL(fieldDef);
                
                if (oldType !== newType) {
                    breaking = true;
                    breakingReasons.push(`Field '${fieldName}' type changed from ${oldType} to ${newType}`);
                }
            }
        }

        for (const fieldName of Object.keys(oldShape)) {
            if (!newShape[fieldName]) {
                breaking = true;
                breakingReasons.push(`Field '${fieldName}' was removed`);
            }
        }

        return { alters, breaking, breakingReasons };
    }

    private extractSchemaShape(schema: z.ZodSchema): Record<string, any> | null {
        if ('shape' in schema && schema.shape) {
            return schema.shape as Record<string, any>;
        }
        
        if ('_def' in schema && schema._def) {
            const def = schema._def as any;
            if (def.shape) {
                return typeof def.shape === 'function' ? def.shape() : def.shape;
            }
        }

        return null;
    }

    private zodTypeToSQL(zodDef: any): string {
        if (!zodDef || !zodDef._def) {
            return 'TEXT';
        }

        const typeName = zodDef._def.typeName;
        
        switch (typeName) {
            case 'ZodString':
                return 'TEXT';
            case 'ZodNumber':
                return 'REAL';
            case 'ZodBigInt':
            case 'ZodInt':
                return 'INTEGER';
            case 'ZodBoolean':
                return 'INTEGER';
            case 'ZodDate':
                return 'TEXT';
            case 'ZodArray':
            case 'ZodObject':
            case 'ZodRecord':
                return 'TEXT';
            case 'ZodOptional':
                return this.zodTypeToSQL(zodDef._def.innerType);
            case 'ZodNullable':
                return this.zodTypeToSQL(zodDef._def.innerType);
            case 'ZodUnion':
                const types = zodDef._def.options;
                if (types && types.length > 0) {
                    return this.zodTypeToSQL(types[0]);
                }
                return 'TEXT';
            default:
                return 'TEXT';
        }
    }

    private isFieldOptional(zodDef: any): boolean {
        if (!zodDef || !zodDef._def) {
            return true;
        }

        const typeName = zodDef._def.typeName;
        
        if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
            return true;
        }

        if (typeName === 'ZodUnion') {
            const options = zodDef._def.options;
            return options && options.some((opt: any) => 
                opt._def && (opt._def.typeName === 'ZodNull' || opt._def.typeName === 'ZodUndefined')
            );
        }

        return false;
    }

    async runMigration(
        collectionName: string, 
        oldVersion: number, 
        newVersion: number, 
        diff: SchemaDiff
    ): Promise<void> {
        if (diff.breaking) {
            throw new DatabaseError(
                `Breaking schema migration required for collection '${collectionName}' (v${oldVersion} → v${newVersion}): ${diff.breakingReasons.join(', ')}. Manual migration required.`,
                'BREAKING_MIGRATION'
            );
        }

        if (diff.alters.length === 0) {
            await this.setStoredVersion(collectionName, newVersion);
            return;
        }

        await this.driver.transaction(async () => {
            for (const alterSQL of diff.alters) {
                await this.driver.exec(alterSQL);
            }
            
            await this.setStoredVersion(collectionName, newVersion, diff.alters);
        });
    }

    async checkAndRunMigration(collectionSchema: CollectionSchema): Promise<void> {
        const { name, version = 1, schema } = collectionSchema;
        
        await this.initializeMigrationsTable();
        
        const storedVersion = await this.getStoredVersion(name);
        
        if (storedVersion === version) {
            return;
        }
        
        if (storedVersion > version) {
            console.warn(
                `Collection '${name}' has stored version ${storedVersion} which is higher than schema version ${version}. ` +
                `This might happen when switching between git branches. No migration will be performed.`
            );
            return;
        }

        let oldSchema: z.ZodSchema | null = null;
        if (storedVersion > 0) {
            oldSchema = schema;
        }

        const diff = this.generateSchemaDiff(oldSchema, schema, name);
        
        if (process.env.SKIBBADB_MIGRATE === 'print') {
            console.log(`Migration plan for ${name} (v${storedVersion} → v${version}):`);
            if (diff.breaking) {
                console.log('  BREAKING CHANGES:', diff.breakingReasons.join(', '));
            }
            for (const alter of diff.alters) {
                console.log(`  ${alter}`);
            }
            return;
        }

        await this.runMigration(name, storedVersion, version, diff);
        
        if (diff.alters.length > 0) {
            console.log(`Migrated collection '${name}' from v${storedVersion} to v${version} (${diff.alters.length} changes)`);
        }
    }

    async getMigrationStatus(): Promise<MigrationInfo[]> {
        await this.initializeMigrationsTable();
        
        const sql = `SELECT collection_name, version, completed_alters FROM ${Migrator.META_TABLE} ORDER BY collection_name`;
        const rows = await this.driver.query(sql);
        
        return rows.map(row => ({
            collectionName: row.collection_name,
            version: row.version,
            completedAlters: JSON.parse(row.completed_alters || '[]')
        }));
    }
}