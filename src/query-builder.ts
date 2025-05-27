import type { QueryFilter, QueryOptions } from './types.js';

export class FieldBuilder<T, K extends keyof T> {
  constructor(
    private field: K,
    private builder: QueryBuilder<T>
  ) {}

  eq(value: T[K]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'eq', value);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  neq(value: T[K]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'neq', value);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  gt(value: T[K]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'gt', value);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  gte(value: T[K]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'gte', value);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  lt(value: T[K]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'lt', value);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  lte(value: T[K]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'lte', value);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  in(values: T[K][]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'in', values);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }

  nin(values: T[K][]): QueryBuilder<T> {
    const newBuilder = this.builder.addFilter(this.field as string, 'nin', values);
    (newBuilder as any).collection = (this.builder as any).collection;
    return newBuilder;
  }
}

export class QueryBuilder<T> {
  private options: QueryOptions = { filters: [] };

  where<K extends keyof T>(field: K): FieldBuilder<T, K> {
    const fieldBuilder = new FieldBuilder(field, this);
    (fieldBuilder as any).collection = (this as any).collection;
    return fieldBuilder;
  }

  addFilter(field: string, operator: QueryFilter['operator'], value: any): QueryBuilder<T> {
    this.options.filters.push({ field, operator, value });
    return this;
  }

  and(): QueryBuilder<T> {
    return this;
  }

  orderBy<K extends keyof T>(field: K, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<T> {
    if (!this.options.orderBy) this.options.orderBy = [];
    this.options.orderBy.push({ field: field as string, direction });
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this.options.limit = count;
    return this;
  }

  offset(count: number): QueryBuilder<T> {
    this.options.offset = count;
    return this;
  }

  getOptions(): QueryOptions {
    return this.options;
  }
}