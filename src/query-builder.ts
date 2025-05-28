import type { QueryFilter, QueryOptions, QueryGroup } from './types';

export class FieldBuilder<T, K extends keyof T> {
    constructor(private field: K, private builder: QueryBuilder<T>) {}

    private addFilterAndReturn(
        operator: any,
        value: any,
        value2?: any
    ): QueryBuilder<T> {
        const newBuilder = this.builder.addFilter(
            this.field as string,
            operator,
            value,
            value2
        );
        (newBuilder as any).collection = (this.builder as any).collection;
        return newBuilder;
    }

    // Equality operators
    eq(value: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('eq', value);
    }

    neq(value: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('neq', value);
    }

    // Comparison operators
    gt(value: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('gt', value);
    }

    gte(value: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('gte', value);
    }

    lt(value: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('lt', value);
    }

    lte(value: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('lte', value);
    }

    // Range operators
    between(min: T[K], max: T[K]): QueryBuilder<T> {
        return this.addFilterAndReturn('between', min, max);
    }

    // Array operators
    in(values: T[K][]): QueryBuilder<T> {
        return this.addFilterAndReturn('in', values);
    }

    nin(values: T[K][]): QueryBuilder<T> {
        return this.addFilterAndReturn('nin', values);
    }

    // String operators (for string fields)
    like(pattern: string): QueryBuilder<T> {
        return this.addFilterAndReturn('like', pattern);
    }

    ilike(pattern: string): QueryBuilder<T> {
        return this.addFilterAndReturn('ilike', pattern);
    }

    startsWith(prefix: string): QueryBuilder<T> {
        return this.addFilterAndReturn('startswith', prefix);
    }

    endsWith(suffix: string): QueryBuilder<T> {
        return this.addFilterAndReturn('endswith', suffix);
    }

    contains(substring: string): QueryBuilder<T> {
        return this.addFilterAndReturn('contains', substring);
    }

    // Existence operator
    exists(): QueryBuilder<T> {
        return this.addFilterAndReturn('exists', true);
    }

    notExists(): QueryBuilder<T> {
        return this.addFilterAndReturn('exists', false);
    }
}

export class QueryBuilder<T> {
    private options: QueryOptions = { filters: [] };

    where<K extends keyof T>(field: K): FieldBuilder<T, K> {
        const fieldBuilder = new FieldBuilder(field, this);
        (fieldBuilder as any).collection = (this as any).collection;
        return fieldBuilder;
    }

    addFilter(
        field: string,
        operator: QueryFilter['operator'],
        value: any,
        value2?: any
    ): QueryBuilder<T> {
        this.options.filters.push({ field, operator, value, value2 });
        return this;
    }

    // Logical operators
    and(): QueryBuilder<T> {
        return this;
    }

    or(
        builderFn: (builder: QueryBuilder<T>) => QueryBuilder<T>
    ): QueryBuilder<T> {
        // Get current filters and new OR conditions
        const currentFilters = [...this.options.filters];

        const orBuilder = new QueryBuilder<T>();
        (orBuilder as any).collection = (this as any).collection;
        const result = builderFn(orBuilder);
        const orConditions = result.getOptions().filters;

        // If we have existing filters, we need to group them
        if (currentFilters.length > 0 && orConditions.length > 0) {
            // Create an OR group containing all current filters and new OR conditions
            const orGroup: QueryGroup = {
                type: 'or',
                filters: [...currentFilters, ...orConditions],
            };

            // Replace all filters with the OR group
            this.options.filters = [orGroup];
        } else if (orConditions.length > 0) {
            // Just add the OR conditions
            this.options.filters.push(...orConditions);
        }

        return this;
    }

    // Create a new OR group with multiple conditions
    orWhere(
        conditions: Array<(builder: QueryBuilder<T>) => QueryBuilder<T>>
    ): QueryBuilder<T> {
        if (conditions.length === 0) return this;

        const currentFilters = [...this.options.filters];
        const orFilters: (QueryFilter | QueryGroup)[] = [];

        for (const condition of conditions) {
            const tempBuilder = new QueryBuilder<T>();
            (tempBuilder as any).collection = (this as any).collection;
            const result = condition(tempBuilder);
            orFilters.push(...result.getOptions().filters);
        }

        if (currentFilters.length > 0 && orFilters.length > 0) {
            // Create an OR group containing all current filters and new OR conditions
            const orGroup: QueryGroup = {
                type: 'or',
                filters: [...currentFilters, ...orFilters],
            };

            // Replace all filters with the OR group
            this.options.filters = [orGroup];
        } else if (orFilters.length > 0) {
            // Just add the OR conditions
            this.options.filters.push(...orFilters);
        }

        return this;
    }

    // Sorting
    orderBy<K extends keyof T>(
        field: K,
        direction: 'asc' | 'desc' = 'asc'
    ): QueryBuilder<T> {
        if (!this.options.orderBy) this.options.orderBy = [];
        this.options.orderBy.push({ field: field as string, direction });
        return this;
    }

    // Clear existing order and add new one
    orderByOnly<K extends keyof T>(
        field: K,
        direction: 'asc' | 'desc' = 'asc'
    ): QueryBuilder<T> {
        this.options.orderBy = [{ field: field as string, direction }];
        return this;
    }

    // Multiple field sorting shorthand
    orderByMultiple(
        orders: { field: keyof T; direction?: 'asc' | 'desc' }[]
    ): QueryBuilder<T> {
        this.options.orderBy = orders.map((order) => ({
            field: order.field as string,
            direction: order.direction || 'asc',
        }));
        return this;
    }

    // Pagination
    limit(count: number): QueryBuilder<T> {
        if (count < 0) throw new Error('Limit must be non-negative');
        this.options.limit = count;
        return this;
    }

    offset(count: number): QueryBuilder<T> {
        if (count < 0) throw new Error('Offset must be non-negative');
        this.options.offset = count;
        return this;
    }

    // Pagination helper
    page(pageNumber: number, pageSize: number): QueryBuilder<T> {
        if (pageNumber < 1) throw new Error('Page number must be >= 1');
        if (pageSize < 1) throw new Error('Page size must be >= 1');

        this.options.limit = pageSize;
        this.options.offset = (pageNumber - 1) * pageSize;
        return this;
    }

    // Grouping and distinct
    groupBy<K extends keyof T>(...fields: K[]): QueryBuilder<T> {
        this.options.groupBy = fields.map((f) => f as string);
        return this;
    }

    distinct(): QueryBuilder<T> {
        this.options.distinct = true;
        return this;
    }

    // Reset methods
    clearFilters(): QueryBuilder<T> {
        this.options.filters = [];
        return this;
    }

    clearOrder(): QueryBuilder<T> {
        this.options.orderBy = undefined;
        return this;
    }

    clearLimit(): QueryBuilder<T> {
        this.options.limit = undefined;
        this.options.offset = undefined;
        return this;
    }

    reset(): QueryBuilder<T> {
        this.options = { filters: [] };
        return this;
    }

    // Query inspection
    getFilterCount(): number {
        return this.options.filters.length;
    }

    hasFilters(): boolean {
        return this.options.filters.length > 0;
    }

    hasOrdering(): boolean {
        return !!this.options.orderBy && this.options.orderBy.length > 0;
    }

    hasPagination(): boolean {
        return (
            this.options.limit !== undefined ||
            this.options.offset !== undefined
        );
    }

    // Clone the query builder
    clone(): QueryBuilder<T> {
        const cloned = new QueryBuilder<T>();
        cloned.options = {
            filters: [...this.options.filters],
            orderBy: this.options.orderBy
                ? [...this.options.orderBy]
                : undefined,
            limit: this.options.limit,
            offset: this.options.offset,
            groupBy: this.options.groupBy
                ? [...this.options.groupBy]
                : undefined,
            distinct: this.options.distinct,
        };
        (cloned as any).collection = (this as any).collection;
        return cloned;
    }

    getOptions(): QueryOptions {
        return this.options;
    }
}
