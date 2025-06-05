import type { z } from 'zod/v4';
import type { Collection } from './collection';
import type { Database } from './database';
import type { Migrator } from './migrator';

export interface UpgradeContext {
    fromVersion: number;
    toVersion: number;
    database: Database;
    transaction: <T>(fn: () => Promise<T>) => Promise<T>;
    migrator: Migrator;
    sql: (query: string, params?: any[]) => Promise<any[]>;
    exec: (query: string, params?: any[]) => Promise<void>;
}

export type UpgradeFunction<T = any> = (
    collection: Collection<any>,
    context: UpgradeContext
) => Promise<void>;

export interface ConditionalUpgrade<T = any> {
    condition?: (collection: Collection<any>) => Promise<boolean>;
    migrate: UpgradeFunction<T>;
}

export type UpgradeDefinition<T = any> =
    | UpgradeFunction<T>
    | ConditionalUpgrade<T>;

export interface UpgradeMap<T = any> {
    [version: number]: UpgradeDefinition<T>;
}

export type SeedFunction<T = any> = (
    collection: Collection<any>
) => Promise<void>;
