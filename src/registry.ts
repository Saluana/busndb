import { z } from 'zod';
import type { CollectionSchema, InferSchema } from './types.js';

export class Registry {
  private collections = new Map<string, CollectionSchema>();

  register<T extends z.ZodSchema>(
    name: string,
    schema: T,
    options: { primaryKey?: string; indexes?: string[] } = {}
  ): CollectionSchema<InferSchema<T>> {
    if (this.collections.has(name)) {
      throw new Error(`Collection '${name}' is already registered`);
    }

    const collectionSchema: CollectionSchema<InferSchema<T>> = {
      name,
      schema,
      primaryKey: options.primaryKey || 'id',
      indexes: options.indexes || []
    };

    this.collections.set(name, collectionSchema);
    return collectionSchema;
  }

  get<T = any>(name: string): CollectionSchema<T> | undefined {
    return this.collections.get(name) as CollectionSchema<T>;
  }

  has(name: string): boolean {
    return this.collections.has(name);
  }

  list(): string[] {
    return Array.from(this.collections.keys());
  }

  clear(): void {
    this.collections.clear();
  }
}