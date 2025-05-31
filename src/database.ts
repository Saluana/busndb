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
import { globalConnectionManager, type ConnectionManager, type ManagedConnection } from './connection-manager';

export class Database {
    private driver?: Driver;
    private managedConnection?: ManagedConnection;
    private config: DBConfig;
    private registry = new Registry();
    private collections = new Map<string, Collection<any>>();
    public plugins = new PluginManager();
    private connectionManager: ConnectionManager;

    constructor(config: DBConfig = {}) {
        this.config = config;
        this.connectionManager = config.connectionPool ? globalConnectionManager : globalConnectionManager;
        
        // Initialize driver based on connection sharing preference
        if (config.sharedConnection) {
            this.initializeLazy();
        } else {
            this.driver = this.createDriver(config);
        }
        
        this.initializePlugins();
    }

    private initializeLazy(): void {
        // Lazy initialization will happen on first database operation
    }

    private async ensureDriver(): Promise<Driver> {
        if (this.driver) {
            return this.driver;
        }

        if (this.config.sharedConnection) {
            // Use connection manager for shared connections
            this.managedConnection = await this.connectionManager.getConnection(this.config, true);
            return this.managedConnection.driver;
        } else {
            // Create dedicated driver
            try {
                this.driver = this.createDriver(this.config);
                return this.driver;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new DatabaseError(
                    `Failed to create dedicated driver: ${message}`,
                    'DRIVER_CREATION_FAILED'
                );
            }
        }
    }

    private async initializePlugins(): Promise<void> {
        await this.plugins.executeHookSafe('onDatabaseInit', {
            collectionName: '',
            schema: {} as any,
            operation: 'database_init',
        });
    }

    private createDriver(config: DBConfig): Driver {
        // Better Bun detection
        const isBun = typeof Bun !== 'undefined' || typeof process !== 'undefined' && process.versions?.bun;
        const driver = config.driver || (isBun ? 'bun' : 'node');

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
            
            // Create collection with lazy driver resolution
            const collection = new Collection<T>(
                this.getDriverProxy(),
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

    private getDriverProxy(): Driver {
        // Create a proxy that resolves the driver lazily
        return new Proxy({} as Driver, {
            get: (target, prop) => {
                if (this.driver) {
                    return (this.driver as any)[prop];
                }
                
                // Return async methods that ensure driver is initialized
                if (prop === 'exec' || prop === 'query' || prop === 'transaction' || prop === 'close') {
                    return async (...args: any[]) => {
                        const driver = await this.ensureDriver();
                        return (driver as any)[prop](...args);
                    };
                }
                
                // Return sync methods that ensure driver is initialized
                if (prop === 'execSync' || prop === 'querySync' || prop === 'closeSync') {
                    return (...args: any[]) => {
                        if (!this.driver) {
                            // For sync methods, we need the driver to be already initialized
                            this.driver = this.createDriver(this.config);
                        }
                        return (this.driver as any)[prop](...args);
                    };
                }
                
                // For other properties, try to get from current driver or throw
                if (this.driver) {
                    return (this.driver as any)[prop];
                }
                
                throw new Error(`Driver not initialized and property ${String(prop)} accessed`);
            }
        });
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        const context = {
            collectionName: '',
            schema: {} as any,
            operation: 'transaction',
        };

        await this.plugins.executeHookSafe('onBeforeTransaction', context);

        try {
            const driver = await this.ensureDriver();
            const result = await driver.transaction(fn);
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
        
        if (this.managedConnection) {
            // Release managed connection back to pool
            await this.connectionManager.releaseConnection(this.managedConnection.id, true);
            this.managedConnection = undefined;
        } else if (this.driver) {
            await this.driver.close();
        }
    }

    closeSync(): void {
        // Note: Plugin hooks are async, so we can't properly await them in sync mode
        if (this.managedConnection) {
            // Cannot release managed connection synchronously
            console.warn('Warning: Cannot release managed connection synchronously');
            this.managedConnection = undefined;
        } else if (this.driver) {
            this.driver.closeSync();
        }
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
        const driver = await this.ensureDriver();
        return driver.exec(sql, params);
    }

    async query(sql: string, params?: any[]): Promise<Row[]> {
        const driver = await this.ensureDriver();
        return driver.query(sql, params);
    }

    // Sync versions for backward compatibility
    execSync(sql: string, params?: any[]): void {
        if (!this.driver) {
            this.driver = this.createDriver(this.config);
        }
        return this.driver.execSync(sql, params);
    }

    querySync(sql: string, params?: any[]): Row[] {
        if (!this.driver) {
            this.driver = this.createDriver(this.config);
        }
        return this.driver.querySync(sql, params);
    }

    // Connection management methods
    getConnectionStats() {
        return this.connectionManager.getStats();
    }

    async closeAllConnections(): Promise<void> {
        await this.connectionManager.closeAll();
    }
}

export function createDB(config: DBConfig = {}): Database {
    return new Database(config);
}
