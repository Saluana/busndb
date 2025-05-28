// Advanced TypeScript utility types for nested path autocomplete support

/**
 * Generates all possible nested paths for an object type
 * Supports dot notation like 'metadata.category' and 'metadata.priority'
 */
export type NestedPaths<T> = {
    [K in keyof T & (string | number)]: T[K] extends object
        ? T[K] extends any[]
            ? `${K}` | `${K}.${number}` | `${K}.${NestedPaths<T[K][number]>}`
            : T[K] extends Date
            ? `${K}`
            : `${K}` | `${K}.${NestedPaths<T[K]>}`
        : `${K}`;
}[keyof T & (string | number)];

/**
 * Gets the value type at a specific nested path
 */
export type NestedValue<T, P extends string> = P extends keyof T
    ? T[P]
    : P extends `${infer K}.${infer R}`
    ? K extends keyof T
        ? T[K] extends object
            ? NestedValue<T[K], R>
            : never
        : never
    : never;

/**
 * Filters paths to only include those with primitive values (queryable types)
 */
export type PrimitivePaths<T> = {
    [K in NestedPaths<T>]: NestedValue<T, K> extends 
        | string 
        | number 
        | boolean 
        | Date 
        | null 
        | undefined
        ? K
        : never;
}[NestedPaths<T>];

/**
 * Generates autocomplete suggestions for nested object paths
 * Includes both top-level and nested properties
 */
export type AutocompletePaths<T> = 
    | keyof T
    | NestedPaths<T>;

/**
 * Safe nested path type that includes string fallback for compatibility
 */
export type SafeNestedPaths<T> = 
    | keyof T
    | NestedPaths<T>
    | string; // Fallback for dynamic paths

/**
 * Utility to extract array element type
 */
export type ArrayElement<T> = T extends (infer U)[] ? U : never;

/**
 * Deep path completion with maximum depth limit (prevents infinite recursion)
 */
export type DeepPaths<T, D extends number = 3> = [D] extends [0]
    ? never
    : {
        [K in keyof T & (string | number)]: T[K] extends object
            ? T[K] extends any[]
                ? `${K}` | `${K}.${number}`
                : T[K] extends Date
                ? `${K}`
                : `${K}` | `${K}.${DeepPaths<T[K], Prev<D>>}`
            : `${K}`;
    }[keyof T & (string | number)];

/**
 * Helper type to decrement depth counter
 */
type Prev<T extends number> = T extends 0
    ? 0
    : T extends 1
    ? 0
    : T extends 2
    ? 1
    : T extends 3
    ? 2
    : T extends 4
    ? 3
    : T extends 5
    ? 4
    : number;

/**
 * Enhanced path completion with better primitive type detection
 */
export type QueryablePaths<T> = DeepPaths<T> | keyof T;

/**
 * Specific type for order by operations (excludes arrays)
 */
export type OrderablePaths<T> = DeepPaths<T> | keyof T;

/**
 * Type for paths that can be used in array operations (in, nin)
 */
export type ArrayQueryPaths<T> = {
    [K in DeepPaths<T>]: NestedValue<T, K> extends any[]
        ? K
        : never;
}[DeepPaths<T>];

/**
 * Example usage types for testing autocomplete
 */
export interface ExampleSchema {
    id: string;
    name: string;
    age: number;
    isActive: boolean;
    metadata: {
        category: string;
        priority: number;
        tags: string[];
        settings: {
            theme: string;
            notifications: boolean;
        };
    };
    profile: {
        bio: string;
        avatar: string;
        social: {
            twitter: string;
            github: string;
        };
    };
    scores: number[];
    createdAt: Date;
}

// Test types (these should provide autocomplete)
type TestPaths = QueryablePaths<ExampleSchema>;
// Should include: 'id', 'name', 'age', 'metadata.category', 'metadata.priority', 
// 'metadata.settings.theme', 'profile.bio', 'profile.social.twitter', etc.

type TestOrderable = OrderablePaths<ExampleSchema>;
// Should include primitive paths but not arrays

type TestArrayPaths = ArrayQueryPaths<ExampleSchema>;
// Should include: 'metadata.tags', 'scores'