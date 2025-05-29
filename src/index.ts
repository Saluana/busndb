export { createDB, Database } from './database';
export { Collection } from './collection';
export { QueryBuilder, FieldBuilder } from './query-builder';
export {
    ValidationError,
    UniqueConstraintError,
    NotFoundError,
    DatabaseError,
} from './errors';
export type {
    DBConfig,
    Driver,
    CollectionSchema,
    InferSchema,
    QueryFilter,
    QueryOptions,
    ConstrainedFieldDefinition,
} from './types';

// Plugin system exports
export { PluginManager } from './plugin-system';
export type { Plugin, PluginContext } from './plugin-system';
export * from './plugins';
