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

// Note: Async methods are available on all classes:
// Database: execAsync(), queryAsync(), closeAsync()
// Collection: insertAsync(), insertBulkAsync(), putAsync(), putBulkAsync(), 
//           deleteAsync(), deleteBulkAsync(), upsertAsync(), upsertBulkAsync(),
//           findByIdAsync(), toArrayAsync(), countAsync(), firstAsync()
// QueryBuilder: toArrayAsync(), firstAsync(), countAsync()
