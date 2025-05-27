export { createDB, Database } from './database.js';
export { Collection } from './collection.js';
export { QueryBuilder, FieldBuilder } from './query-builder.js';
export { 
  ValidationError, 
  UniqueConstraintError, 
  NotFoundError, 
  DatabaseError 
} from './errors.js';
export type { 
  DBConfig, 
  Driver, 
  CollectionSchema, 
  InferSchema,
  QueryFilter,
  QueryOptions 
} from './types.js';