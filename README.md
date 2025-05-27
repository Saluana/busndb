# BusNDB

A developer-friendly, embeddable NoSQL database layer on top of SQLite that boots up in seconds with a single command, enforces schemas and type safety via Zod, and exposes intuitive, fully typed CRUD and query APIs.

## Features

- 🚀 **Zero Configuration**: Single function call to get started
- 🔒 **Type Safety**: Full TypeScript support with Zod schema validation
- ⚡ **High Performance**: Built on SQLite with optimized queries
- 🔍 **Intuitive Queries**: Chainable query builder inspired by Dexie and Supabase
- 💾 **ACID Transactions**: Full transaction support
- 🔗 **Relationships**: Foreign key support with cascading deletes
- 🧩 **Extensible**: Plugin system for custom functionality
- 🌐 **Cross-Platform**: Works with both Bun and Node.js

## Quick Start

```typescript
import { z } from 'zod';
import { createDB } from 'busndb';

// Define your schema
const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().optional(),
  createdAt: z.date().default(() => new Date())
});

// Create database and collection
const db = createDB({ memory: true }); // or { path: 'mydb.db' }
const users = db.collection('users', userSchema);

// Insert data
const user = users.insert({
  name: 'Alice Johnson',
  email: 'alice@example.com',
  age: 28
});

// Query data
const adults = users.where('age').gte(18).toArray();
const alice = users.where('email').eq('alice@example.com').first();

// Update data
const updated = users.put(user.id, { age: 29 });

// Advanced queries
const results = users
  .where('age').gte(25)
  .and().where('age').lt(35)
  .orderBy('name')
  .limit(10)
  .toArray();
```

## Installation

```bash
bun add busndb zod
# or
npm install busndb zod
```

## API Reference

### Database

```typescript
// Create database
const db = createDB({
  path?: string;     // File path (default: 'database.db')
  memory?: boolean;  // Use in-memory database
  driver?: 'bun' | 'node'; // Driver to use
});

// Collections
const collection = db.collection('name', schema, options?);
const existing = db.collection('name'); // Get existing collection

// Transactions
await db.transaction(async () => {
  // Multiple operations in transaction
});

// Cleanup
db.close();
```

### Collections

```typescript
// CRUD Operations
collection.insert(doc);
collection.insertBulk(docs);
collection.put(id, partialDoc);
collection.putBulk(updates);
collection.delete(id);
collection.deleteBulk(ids);
collection.findById(id);

// Basic Comparison Operators
collection.where('field').eq(value);        // Equal
collection.where('field').neq(value);       // Not equal
collection.where('field').gt(value);        // Greater than
collection.where('field').gte(value);       // Greater than or equal
collection.where('field').lt(value);        // Less than
collection.where('field').lte(value);       // Less than or equal
collection.where('field').between(min, max); // Between range

// Array Operators
collection.where('field').in(values);       // Value in array
collection.where('field').nin(values);      // Value not in array

// String Operators
collection.where('field').like(pattern);    // SQL LIKE pattern
collection.where('field').ilike(pattern);   // Case-insensitive LIKE
collection.where('field').startsWith(prefix); // Starts with prefix
collection.where('field').endsWith(suffix); // Ends with suffix
collection.where('field').contains(substring); // Contains substring

// Existence Operators
collection.where('field').exists();         // Field has value
collection.where('field').notExists();      // Field is null/undefined

// Logical Operators
.and()                                       // Explicit AND (optional)

// Sorting
.orderBy('field', 'asc' | 'desc')          // Single field sort
.orderByOnly('field', 'asc' | 'desc')      // Replace existing sorts
.orderByMultiple([                          // Multiple field sort
  { field: 'field1', direction: 'asc' },
  { field: 'field2', direction: 'desc' }
])

// Pagination
.limit(count)                               // Limit results
.offset(count)                              // Skip results
.page(pageNumber, pageSize)                 // Page-based pagination

// Advanced Options
.distinct()                                 // Unique results only
.groupBy(...fields)                         // Group by fields

// State Management
.clearFilters()                             // Remove all filters
.clearOrder()                               // Remove sorting
.clearLimit()                               // Remove pagination
.reset()                                    // Clear all state
.clone()                                    // Clone query builder

// Query Inspection
.hasFilters()                               // Check if has filters
.hasOrdering()                              // Check if has sorting
.hasPagination()                            // Check if has pagination
.getFilterCount()                           // Get number of filters

// Execute Queries
.toArray()                                  // Get all results
.first()                                    // Get first result or null
.count()                                    // Count matching records

// Direct Collection Methods (return QueryBuilder)
collection.orderBy('field', 'direction');
collection.limit(count);
collection.offset(count);
collection.page(pageNumber, pageSize);
collection.distinct();
collection.orderByMultiple(orders);
```

## Examples

### Complex Queries

```typescript
const users = db.collection('users', userSchema);

// Multiple conditions
const seniorDevelopers = users
  .where('department').eq('Engineering')
  .where('level').eq('senior')
  .where('isActive').eq(true)
  .orderBy('salary', 'desc')
  .toArray();

// Range queries
const midCareerEmployees = users
  .where('age').between(28, 35)
  .where('salary').gte(75000)
  .orderBy('experience', 'desc')
  .toArray();

// String searches
const searchResults = users
  .where('name').contains('John')
  .where('email').endsWith('@company.com')
  .where('skills').contains('TypeScript')
  .toArray();

// Advanced pagination
const employeeDirectory = users
  .where('isActive').eq(true)
  .orderBy('department')
  .orderBy('name')
  .page(2, 10)
  .toArray();

// Existence and array queries
const consultants = users
  .where('metadata').exists()
  .where('skills').in(['React', 'Vue', 'Angular'])
  .where('location').nin(['Remote'])
  .toArray();

// Aggregation queries
const departmentStats = {
  totalEngineers: users.where('department').eq('Engineering').count(),
  activeEngineers: users
    .where('department').eq('Engineering')
    .where('isActive').eq(true)
    .count(),
  topPerformer: users
    .where('department').eq('Engineering')
    .orderBy('performanceScore', 'desc')
    .first()
};
```

### Transactions

```typescript
await db.transaction(async () => {
  const user = users.insert({ name: 'John', email: 'john@example.com' });
  posts.insert({
    title: 'Hello World',
    content: 'My first post',
    authorId: user.id
  });
});
```

### Error Handling

```typescript
import { ValidationError, NotFoundError, UniqueConstraintError } from 'busndb';

try {
  users.insert(invalidData);
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation failed:', error.details);
  }
}
```

## Performance

BusNDB delivers excellent performance for embedded use cases:

- **Inserts**: ~27,000 ops/sec (single), ~46,000 ops/sec (bulk)
- **Queries**: ~235 ops/sec (point queries), ~128 ops/sec (range queries)
- **Updates**: ~226 ops/sec
- **Deletes**: ~55,000 ops/sec

*Benchmarks run on Apple M1 with in-memory database*

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run example
bun run example.ts

# Run benchmark
bun run benchmark.ts
```

## License

MIT