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

// Queries
collection.where('field').eq(value);
collection.where('field').neq(value);
collection.where('field').gt(value);
collection.where('field').gte(value);
collection.where('field').lt(value);
collection.where('field').lte(value);
collection.where('field').in(values);
collection.where('field').nin(values);

// Query modifiers
.and()
.orderBy('field', 'asc' | 'desc')
.limit(count)
.offset(count)

// Execute queries
.toArray()   // Get all results
.first()     // Get first result
.count()     // Count results
```

## Examples

### Complex Queries

```typescript
const posts = db.collection('posts', postSchema);

// Find published posts by specific author, ordered by date
const recentPosts = posts
  .where('authorId').eq(userId)
  .and().where('published').eq(true)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .toArray();

// Count posts in category
const count = posts
  .where('category').eq('tech')
  .where('published').eq(true)
  .count();
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