import { z } from 'zod';
import type {
    DBConfig,
    Driver,
    InferSchema,
    ConstrainedFieldDefinition,
    Row,
} from './types';
import { DatabaseError } from './errors';
import type { SchemaConstraints } from './schema-constraints';
import { NodeDriver } from './drivers/node';
import { Collection } from './collection';
import { Registry } from './registry';
import { PluginManager, type Plugin } from './plugin-system';

export class Database {
    private driver: Driver;
    private registry = new Registry();
    private collections = new Map<string, Collection<any>>();
    public plugins = new PluginManager();

    constructor(config: DBConfig = {}) {
        this.driver = this.createDriver(config);
        this.initializePlugins();
    }

    private async initializePlugins(): Promise<void> {
        await this.plugins.executeHookSafe('onDatabaseInit', {
            collectionName: '',
            schema: {} as any,
            operation: 'database_init',
        });
    }

    private createDriver(config: DBConfig): Driver {
        const driver =
            config.driver || (typeof Bun !== 'undefined' ? 'bun' : 'node');

        try {
            switch (driver) {
                case 'bun':
                    // Dynamic import to avoid Node.js resolving bun: protocol during static analysis
                    try {
                        const { BunDriver } = require('./drivers/bun');
                        return new BunDriver(config);
                    } catch (e) {
                        throw new Error(
                            'BunDriver is only available in Bun runtime. Use driver: "node" instead.'
                        );
                    }
                case 'node':
                    return new NodeDriver(config);
                default:
                    throw new Error(`Unknown driver: ${driver}`);
            }
        } catch (error) {
            throw new DatabaseError(
                `Failed to initialize database driver '${driver}': ${(error as Error).message}`,
                'DRIVER_INIT_FAILED'
            );
        }
    }

    collection<T extends z.ZodSchema>(
        name: string,
        schema?: T,
        options?: {
            primaryKey?: string;
            indexes?: string[];
            constraints?: SchemaConstraints;
            constrainedFields?: {
                [fieldPath: string]: ConstrainedFieldDefinition;
            };
        }
    ): Collection<T> {
        if (schema) {
            if (this.collections.has(name)) {
                throw new Error(`Collection '${name}' already exists`);
            }

            const collectionSchema = this.registry.register(
                name,
                schema,
                options
            );
            const collection = new Collection<T>(
                this.driver,
                collectionSchema,
                this.plugins
            );
            this.collections.set(name, collection);

            // Execute collection creation hook (non-blocking)
            this.plugins
                .executeHookSafe('onCollectionCreate', {
                    collectionName: name,
                    schema: collectionSchema,
                    operation: 'collection_create',
                })
                .catch(console.warn);

            return collection;
        }

        const existingCollection = this.collections.get(name);
        if (!existingCollection) {
            throw new Error(`Collection '${name}' not found`);
        }

        return existingCollection;
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        const context = {
            collectionName: '',
            schema: {} as any,
            operation: 'transaction',
        };

        await this.plugins.executeHookSafe('onBeforeTransaction', context);

        try {
            const result = await this.driver.transaction(fn);
            await this.plugins.executeHookSafe('onAfterTransaction', {
                ...context,
                result,
            });
            return result;
        } catch (error) {
            // Enhanced error recovery for transaction failures
            const transactionError = error instanceof Error ? error : new Error(String(error));
            
            try {
                await this.plugins.executeHookSafe('onTransactionError', {
                    ...context,
                    error: transactionError,
                });
            } catch (pluginError) {
                // If plugin error handling fails, log it but don't override the original error
                console.warn('Transaction error plugin hook failed:', pluginError);
            }
            
            // Only wrap specific database-level errors, preserve application errors
            if (transactionError.message.includes('database is locked') || 
                transactionError.message.includes('busy') ||
                transactionError.message.includes('timeout')) {
                throw new DatabaseError(
                    `Transaction failed due to database lock or timeout: ${transactionError.message}`,
                    'TRANSACTION_LOCK_TIMEOUT'
                );
            }
            
            if (transactionError.message.includes('rollback') ||
                transactionError.message.includes('abort')) {
                throw new DatabaseError(
                    `Transaction was rolled back: ${transactionError.message}`,
                    'TRANSACTION_ROLLBACK'
                );
            }
            
            // Re-throw original error to preserve validation and application errors
            throw error;
        }
    }

    async close(): Promise<void> {
        await this.plugins.executeHookSafe('onDatabaseClose', {
            collectionName: '',
            schema: {} as any,
            operation: 'database_close',
        });
        await this.driver.close();
    }

    closeSync(): void {
        // Note: Plugin hooks are async, so we can't properly await them in sync mode
        this.driver.closeSync();
    }

    // Plugin management methods
    use(plugin: Plugin): this {
        this.plugins.register(plugin);
        return this;
    }

    unuse(pluginName: string): this {
        this.plugins.unregister(pluginName);
        return this;
    }

    getPlugin(name: string): Plugin | undefined {
        return this.plugins.getPlugin(name);
    }

    listPlugins(): Plugin[] {
        return this.plugins.listPlugins();
    }

    listCollections(): string[] {
        return this.registry.list();
    }

    async exec(sql: string, params?: any[]): Promise<void> {
        return this.driver.exec(sql, params);
    }

    async query(sql: string, params?: any[]): Promise<Row[]> {
        return this.driver.query(sql, params);
    }

    // Sync versions for backward compatibility
    execSync(sql: string, params?: any[]): void {
        return this.driver.execSync(sql, params);
    }

    querySync(sql: string, params?: any[]): Row[] {
        return this.driver.querySync(sql, params);
    }
}

export function createDB(config: DBConfig = {}): Database {
    return new Database(config);
}
