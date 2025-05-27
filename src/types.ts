import { z } from 'zod';

export interface DBConfig {
  path?: string;
  memory?: boolean;
  driver?: 'bun' | 'node';
}

export interface Driver {
  exec(sql: string, params?: any[]): void;
  query(sql: string, params?: any[]): Row[];
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
}

export interface Row {
  [key: string]: any;
}

export interface CollectionSchema<T = any> {
  name: string;
  schema: z.ZodSchema<T>;
  primaryKey: string;
  indexes?: string[];
}

export type InferSchema<T> = T extends z.ZodSchema<infer U> ? U : never;

export interface QueryFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like' | 'ilike' | 'startswith' | 'endswith' | 'contains' | 'exists' | 'between';
  value: any;
  value2?: any; // For between operator
}

export interface QueryOptions {
  filters: QueryFilter[];
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
  groupBy?: string[];
  distinct?: boolean;
}