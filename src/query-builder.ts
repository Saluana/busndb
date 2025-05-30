import type { 
    QueryFilter, 
    QueryOptions, 
    QueryGroup, 
    AggregateField, 
    JoinClause, 
    JoinCondition,
    SubqueryFilter 
} from './types';
import type { 
    QueryablePaths, 
    OrderablePaths, 
    NestedValue, 
    SafeNestedPaths 
} from './types/nested-paths';

export class FieldBuilder<T, K extends QueryablePaths<T> | string> {
    constructor(protected field: K, protected builder: QueryBuilder<T>) {}

    protected addFilterAndReturn(
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
    eq(value: any): QueryBuilder<T> {
        return this.addFilterAndReturn('eq', value);
    }

    neq(value: any): QueryBuilder<T> {
        return this.addFilterAndReturn('neq', value);
    }

    // Comparison operators
    gt(value: any): QueryBuilder<T> {
        return this.addFilterAndReturn('gt', value);
    }

    gte(value: any): QueryBuilder<T> {
        return this.addFilterAndReturn('gte', value);
    }

    lt(value: any): QueryBuilder<T> {
        return this.addFilterAndReturn('lt', value);
    }

    lte(value: any): QueryBuilder<T> {
        return this.addFilterAndReturn('lte', value);
    }

    // Range operators
    between(min: any, max: any): QueryBuilder<T> {
        return this.addFilterAndReturn('between', min, max);
    }

    // Array operators
    in(values: any[]): QueryBuilder<T> {
        return this.addFilterAndReturn('in', values);
    }

    nin(values: any[]): QueryBuilder<T> {
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

    // Subquery operators
    existsSubquery(subqueryBuilder: QueryBuilder<any>, collection: string): QueryBuilder<T> {
        return this.builder.addSubqueryFilter(this.field as string, 'exists', subqueryBuilder, collection);
    }

    notExistsSubquery(subqueryBuilder: QueryBuilder<any>, collection: string): QueryBuilder<T> {
        return this.builder.addSubqueryFilter(this.field as string, 'not_exists', subqueryBuilder, collection);
    }

    inSubquery(subqueryBuilder: QueryBuilder<any>, collection: string): QueryBuilder<T> {
        return this.builder.addSubqueryFilter(this.field as string, 'in', subqueryBuilder, collection);
    }

    notInSubquery(subqueryBuilder: QueryBuilder<any>, collection: string): QueryBuilder<T> {
        return this.builder.addSubqueryFilter(this.field as string, 'not_in', subqueryBuilder, collection);
    }

    // Enhanced JSON path operations
    arrayLength(operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte', value: number): QueryBuilder<T> {
        return this.builder.addJsonArrayLengthFilter(this.field as string, operator, value);
    }

    arrayContains(value: any): QueryBuilder<T> {
        return this.builder.addJsonArrayContainsFilter(this.field as string, value);
    }

    arrayNotContains(value: any): QueryBuilder<T> {
        return this.builder.addJsonArrayNotContainsFilter(this.field as string, value);
    }
}

export class HavingFieldBuilder<T, K extends QueryablePaths<T> | string> extends FieldBuilder<T, K> {
    constructor(field: K, builder: QueryBuilder<T>) {
        super(field, builder);
    }

    protected addFilterAndReturn(
        operator: any,
        value: any,
        value2?: any
    ): QueryBuilder<T> {
        const newBuilder = this.builder.addHavingFilter(
            this.field as string,
            operator,
            value,
            value2
        );
        (newBuilder as any).collection = (this.builder as any).collection;
        return newBuilder;
    }
}

export class QueryBuilder<T> {
    private options: QueryOptions = { filters: [] };

    where<K extends QueryablePaths<T>>(field: K): FieldBuilder<T, K>;
    where(field: string): FieldBuilder<T, any>;
    where<K extends QueryablePaths<T>>(field: K | string): FieldBuilder<T, K> {
        const fieldBuilder = new FieldBuilder(field as K, this);
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

    addSubqueryFilter(
        field: string,
        operator: 'exists' | 'not_exists' | 'in' | 'not_in',
        subqueryBuilder: QueryBuilder<any>,
        collection: string
    ): QueryBuilder<T> {
        const subqueryFilter: SubqueryFilter = {
            field,
            operator,
            subquery: subqueryBuilder.getOptions(),
            subqueryCollection: collection
        };
        this.options.filters.push(subqueryFilter);
        return this;
    }

    // Enhanced JSON operations
    addJsonArrayLengthFilter(field: string, operator: string, value: number): QueryBuilder<T> {
        this.options.filters.push({ 
            field: `json_array_length(${field})`, 
            operator: operator as any, 
            value 
        });
        return this;
    }

    addJsonArrayContainsFilter(field: string, value: any): QueryBuilder<T> {
        this.options.filters.push({ 
            field: field, 
            operator: 'json_array_contains' as any, 
            value 
        });
        return this;
    }

    addJsonArrayNotContainsFilter(field: string, value: any): QueryBuilder<T> {
        this.options.filters.push({ 
            field: field, 
            operator: 'json_array_not_contains' as any, 
            value 
        });
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
        const orFilters: (QueryFilter | QueryGroup | SubqueryFilter)[] = [];

        for (const condition of conditions) {
            const tempBuilder = new QueryBuilder<T>();
            (tempBuilder as any).collection = (this as any).collection;
            const result = condition(tempBuilder);
            orFilters.push(...result.getOptions().filters);
        }

        if (orFilters.length > 0) {
            if (currentFilters.length > 0) {
                // Create an OR group containing all current filters and new OR conditions
                const orGroup: QueryGroup = {
                    type: 'or',
                    filters: [...currentFilters, ...orFilters],
                };
                // Replace all filters with the OR group
                this.options.filters = [orGroup];
            } else {
                // No current filters, just create an OR group with the OR conditions
                const orGroup: QueryGroup = {
                    type: 'or',
                    filters: orFilters,
                };
                this.options.filters = [orGroup];
            }
        }

        return this;
    }

    // Sorting
    orderBy<K extends OrderablePaths<T>>(
        field: K,
        direction?: 'asc' | 'desc'
    ): QueryBuilder<T>;
    orderBy(
        field: string,
        direction?: 'asc' | 'desc'
    ): QueryBuilder<T>;
    orderBy<K extends OrderablePaths<T>>(
        field: K | string,
        direction: 'asc' | 'desc' = 'asc'
    ): QueryBuilder<T> {
        if (!this.options.orderBy) this.options.orderBy = [];
        this.options.orderBy.push({ field: field as string, direction });
        return this;
    }

    // Clear existing order and add new one
    orderByOnly<K extends OrderablePaths<T>>(
        field: K,
        direction?: 'asc' | 'desc'
    ): QueryBuilder<T>;
    orderByOnly(
        field: string,
        direction?: 'asc' | 'desc'
    ): QueryBuilder<T>;
    orderByOnly<K extends OrderablePaths<T>>(
        field: K | string,
        direction: 'asc' | 'desc' = 'asc'
    ): QueryBuilder<T> {
        this.options.orderBy = [{ field: field as string, direction }];
        return this;
    }

    // Multiple field sorting shorthand
    orderByMultiple(
        orders: { field: OrderablePaths<T> | string; direction?: 'asc' | 'desc' }[]
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
    groupBy<K extends OrderablePaths<T>>(...fields: K[]): QueryBuilder<T> {
        this.options.groupBy = fields.map((f) => f as string);
        return this;
    }

    distinct(): QueryBuilder<T> {
        this.options.distinct = true;
        return this;
    }

    // Aggregate functions
    select(...fields: string[]): QueryBuilder<T> {
        this.options.selectFields = fields;
        return this;
    }

    aggregate(fn: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX', field: string = '*', alias?: string, distinct?: boolean): QueryBuilder<T> {
        if (!this.options.aggregates) this.options.aggregates = [];
        this.options.aggregates.push({ function: fn, field, alias, distinct });
        return this;
    }

    count(field: string = '*', alias?: string, distinct?: boolean): QueryBuilder<T> {
        return this.aggregate('COUNT', field, alias, distinct);
    }

    sum(field: string, alias?: string, distinct?: boolean): QueryBuilder<T> {
        return this.aggregate('SUM', field, alias, distinct);
    }

    avg(field: string, alias?: string, distinct?: boolean): QueryBuilder<T> {
        return this.aggregate('AVG', field, alias, distinct);
    }

    min(field: string, alias?: string): QueryBuilder<T> {
        return this.aggregate('MIN', field, alias);
    }

    max(field: string, alias?: string): QueryBuilder<T> {
        return this.aggregate('MAX', field, alias);
    }

    // HAVING clause support
    having<K extends QueryablePaths<T>>(field: K): FieldBuilder<T, K>;
    having(field: string): FieldBuilder<T, any>;
    having<K extends QueryablePaths<T>>(field: K | string): FieldBuilder<T, K> {
        const fieldBuilder = new HavingFieldBuilder(field as K, this);
        (fieldBuilder as any).collection = (this as any).collection;
        return fieldBuilder;
    }

    addHavingFilter(
        field: string,
        operator: QueryFilter['operator'],
        value: any,
        value2?: any
    ): QueryBuilder<T> {
        if (!this.options.having) this.options.having = [];
        this.options.having.push({ field, operator, value, value2 });
        return this;
    }

    // JOIN operations
    join<U = any>(
        collection: string,
        leftField: string,
        rightField: string,
        operator: '=' | '!=' | '>' | '<' | '>=' | '<=' = '='
    ): QueryBuilder<T & U> {
        if (!this.options.joins) this.options.joins = [];
        this.options.joins.push({
            type: 'INNER',
            collection,
            condition: { left: leftField, right: rightField, operator }
        });
        return this as any;
    }

    leftJoin<U = any>(
        collection: string,
        leftField: string,
        rightField: string,
        operator: '=' | '!=' | '>' | '<' | '>=' | '<=' = '='
    ): QueryBuilder<T & U> {
        if (!this.options.joins) this.options.joins = [];
        this.options.joins.push({
            type: 'LEFT',
            collection,
            condition: { left: leftField, right: rightField, operator }
        });
        return this as any;
    }

    rightJoin<U = any>(
        collection: string,
        leftField: string,
        rightField: string,
        operator: '=' | '!=' | '>' | '<' | '>=' | '<=' = '='
    ): QueryBuilder<T & U> {
        if (!this.options.joins) this.options.joins = [];
        this.options.joins.push({
            type: 'RIGHT',
            collection,
            condition: { left: leftField, right: rightField, operator }
        });
        return this as any;
    }

    fullJoin<U = any>(
        collection: string,
        leftField: string,
        rightField: string,
        operator: '=' | '!=' | '>' | '<' | '>=' | '<=' = '='
    ): QueryBuilder<T & U> {
        if (!this.options.joins) this.options.joins = [];
        this.options.joins.push({
            type: 'FULL',
            collection,
            condition: { left: leftField, right: rightField, operator }
        });
        return this as any;
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
            having: this.options.having
                ? [...this.options.having]
                : undefined,
            distinct: this.options.distinct,
            aggregates: this.options.aggregates
                ? [...this.options.aggregates]
                : undefined,
            joins: this.options.joins
                ? [...this.options.joins]
                : undefined,
            selectFields: this.options.selectFields
                ? [...this.options.selectFields]
                : undefined,
        };
        (cloned as any).collection = (this as any).collection;
        return cloned;
    }

    getOptions(): QueryOptions {
        return this.options;
    }
}
