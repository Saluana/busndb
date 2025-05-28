# BusNDB

A developer-friendly, embeddable NoSQL database layer on top of SQLite that boots up in seconds with a single command, enforces schemas and type safety via Zod, and exposes intuitive, fully typed CRUD and query APIs.

## Features

-   🚀 **Zero Configuration**: Single function call to get started
-   🔒 **Type Safety**: Full TypeScript support with Zod schema validation
-   ⚡ **High Performance**: Built on SQLite with optimized queries
-   🔍 **Intuitive Queries**: Chainable query builder inspired by Dexie and Supabase
-   💾 **ACID Transactions**: Full transaction support
-   🔗 **Relationships**: Foreign key support with cascading deletes
-   🧩 **Extensible**: Plugin system for custom functionality
-   🌐 **Cross-Platform**: Works with both Bun and Node.js

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
    createdAt: z.date().default(() => new Date()),
});

// Create database and collection
const db = createDB({ memory: true }); // or { path: 'mydb.db' }
const users = db.collection('users', userSchema);

// Insert data
const user = users.insert({
    name: 'Alice Johnson',
    email: 'alice@example.com',
    age: 28,
});

// Query data
const adults = users.where('age').gte(18).toArray();
const alice = users.where('email').eq('alice@example.com').first();

// Update data
const updated = users.put(user.id, { age: 29 });

// Advanced queries
const results = users
    .where('age')
    .gte(25)
    .and()
    .where('age')
    .lt(35)
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

```ts
const db = createDB({ path?: string; memory?: boolean; driver?: 'bun' | 'node' });
const users = db.collection('users', userSchema); // create or get existing
await db.transaction(async () => { /* transactional operations */ });
db.close();
```

### Collections

#### Collection Methods (CRUD & Bulk)

```ts
// Create
const newDoc = users.insert({
    /* fields except id */
});
const docs = users.insertBulk([
    {
        /* ... */
    },
]);

// Read
const found = users.findById(newDoc.id); // returns T | null
const all = users.toArray();

// Update
const updated = users.put(newDoc.id, {
    /* partial fields */
});
const updatedBulk = users.putBulk([
    {
        id: newDoc.id,
        doc: {
            /* ... */
        },
    },
]);

// Delete
const ok = users.delete(newDoc.id); // returns true
const count = users.deleteBulk([newDoc.id]); // returns number deleted

// Upsert
const up = users.upsert(newId, {
    /* fields */
});
const upBulk = users.upsertBulk([
    {
        id: newId,
        doc: {
            /* ... */
        },
    },
]);
```

#### Query Builder Methods

```ts
// Comparison operators
enum Op {
    eq,
    neq,
    gt,
    gte,
    lt,
    lte,
    between,
}
users.where('field').eq(value);
users.where('field').between(min, max);

// Array operators
users.where('field').in([v1, v2]);
users.where('field').nin([v1, v2]);

// String operators
users.where('field').like('pattern%');
users.where('field').ilike('%pattern%');
users.where('field').startsWith(prefix);
users.where('field').endsWith(suffix);
users.where('field').contains(substr);

// Existence
users.where('field').exists();
users.where('field').notExists();

// Logical
users.where('a').eq(1).and().where('b').eq(2);
users
    .where('x')
    .eq(1)
    .or((builder) => builder.where('y').eq(2));
users.orWhere([(b) => b.where('a').eq(1), (b) => b.where('b').gt(5)]);

// Sorting & Pagination
users.orderBy('field', 'asc');
users.orderByOnly('field', 'desc');
users.orderByMultiple([{ field: 'a', direction: 'asc' }]);
users.limit(10).offset(5).page(2, 10);

// Grouping & Distinct
users.groupBy('field1', 'field2');
users.distinct();

// State management
users.clearFilters();
users.clearOrder();
users.clearLimit();
users.reset();
users.clone();

// Inspection
users.hasFilters();
users.hasOrdering();
users.hasPagination();
users.getFilterCount();

// Execution
users.toArray();
users.first();
users.count();
```

#### Direct Collection Shortcuts

```ts
users.orderBy('field');
users.limit(5);
users.offset(5);
users.page(1, 10);
users.distinct();
users.orderByMultiple([{ field: 'f1' }, { field: 'f2', direction: 'desc' }]);
users.or((b) => b.where('a').eq(1));
```

## Examples

### Complex Queries

```typescript
const users = db.collection('users', userSchema);

// Multiple conditions
const seniorDevelopers = users
    .where('department')
    .eq('Engineering')
    .where('level')
    .eq('senior')
    .where('isActive')
    .eq(true)
    .orderBy('salary', 'desc')
    .toArray();

// Range queries
const midCareerEmployees = users
    .where('age')
    .between(28, 35)
    .where('salary')
    .gte(75000)
    .orderBy('experience', 'desc')
    .toArray();

// String searches
const searchResults = users
    .where('name')
    .contains('John')
    .where('email')
    .endsWith('@company.com')
    .where('skills')
    .contains('TypeScript')
    .toArray();

// Advanced pagination
const employeeDirectory = users
    .where('isActive')
    .eq(true)
    .orderBy('department')
    .orderBy('name')
    .page(2, 10)
    .toArray();

// Existence and array queries
const consultants = users
    .where('metadata')
    .exists()
    .where('skills')
    .in(['React', 'Vue', 'Angular'])
    .where('location')
    .nin(['Remote'])
    .toArray();

// OR queries
const flexibleSearch = users
    .where('department')
    .eq('Engineering')
    .or((builder) =>
        builder.where('salary').gt(100000).where('isActive').eq(true)
    )
    .toArray();

// Multiple OR conditions
const seniorStaff = users
    .where('age')
    .gt(40)
    .orWhere([
        (builder) => builder.where('level').eq('senior'),
        (builder) => builder.where('department').eq('Management'),
    ])
    .toArray();

// Complex OR with AND combinations
const emergencyContacts = users
    .where('isActive')
    .eq(true)
    .where('department')
    .in(['Engineering', 'Operations'])
    .or((builder) =>
        builder.where('role').eq('Manager').where('onCallStatus').eq(true)
    )
    .toArray();

// Aggregation queries
const departmentStats = {
    totalEngineers: users.where('department').eq('Engineering').count(),
    activeEngineers: users
        .where('department')
        .eq('Engineering')
        .where('isActive')
        .eq(true)
        .count(),
    topPerformer: users
        .where('department')
        .eq('Engineering')
        .orderBy('performanceScore', 'desc')
        .first(),
};
```

### Transactions

Transactions allow grouping multiple read/write operations into a single atomic unit. If any operation inside the callback throws, all changes are rolled back. Under the hood this uses SQLite BEGIN/COMMIT/ROLLBACK.

```ts
// Simple transaction: atomic insert of user and related post
await db.transaction(async () => {
    const user = users.insert({ name: 'John', email: 'john@example.com' });
    posts.insert({
        title: 'Hello World',
        content: 'My first post',
        authorId: user.id,
    });
});
```

You can also return a value from inside the transaction callback:

```ts
const savedUser = await db.transaction(async () => {
    const user = users.insert({ name: 'Jane', email: 'jane@example.com' });
    profiles.insert({ userId: user.id, bio: 'New user' });
    return user; // this value is propagated
});
console.log('Transaction created user:', savedUser.id);
```

#### Error handling and rollback

Any exception thrown within the callback automatically triggers a rollback:

```ts
try {
    await db.transaction(async () => {
        users.insert({ name: 'Bad', email: 'bad-email' }); // invalid email => ValidationError
        // following operations are not applied
        orders.insert({ userId: 'unknown', total: 100 });
    });
} catch (err) {
    console.error('Transaction failed, all changes reverted:', err);
}
```

#### Nested transactions

SQLite does not support true nested transactions; attempting a nested `db.transaction` will reuse the same transaction context. For explicit savepoints use custom SQL via `db.driver.exec('SAVEPOINT name')`.

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

-   **Inserts**: ~27,000 ops/sec (single), ~46,000 ops/sec (bulk)
-   **Queries**: ~235 ops/sec (point queries), ~128 ops/sec (range queries)
-   **Updates**: ~226 ops/sec
-   **Deletes**: ~55,000 ops/sec

_Benchmarks run on Apple M1 with in-memory database_

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
