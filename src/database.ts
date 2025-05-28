import { z } from 'zod';
import type { DBConfig, Driver, InferSchema } from './types';
import type { SchemaConstraints } from './schema-constraints';
import { BunDriver } from './drivers/bun';
import { Collection } from './collection';
import { Registry } from './registry';

export class Database {
    private driver: Driver;
    private registry = new Registry();
    private collections = new Map<string, Collection<any>>();

    constructor(config: DBConfig = {}) {
        this.driver = this.createDriver(config);
    }

    private createDriver(config: DBConfig): Driver {
        const driver =
            config.driver || (typeof Bun !== 'undefined' ? 'bun' : 'node');

        switch (driver) {
            case 'bun':
                return new BunDriver(config);
            case 'node':
                throw new Error('Node.js driver not implemented yet');
            default:
                throw new Error(`Unknown driver: ${driver}`);
        }
    }

    collection<T extends z.ZodSchema>(
        name: string,
        schema?: T,
        options?: { 
            primaryKey?: string; 
            indexes?: string[];
            constraints?: SchemaConstraints;
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
            const collection = new Collection<T>(this.driver, collectionSchema);
            this.collections.set(name, collection);
            return collection;
        }

        const existingCollection = this.collections.get(name);
        if (!existingCollection) {
            throw new Error(`Collection '${name}' not found`);
        }

        return existingCollection;
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        return this.driver.transaction(fn);
    }

    close(): void {
        this.driver.close();
    }

    listCollections(): string[] {
        return this.registry.list();
    }
}

export function createDB(config: DBConfig = {}): Database {
    return new Database(config);
}
