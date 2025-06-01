# Schema Migrations & Versioning

SkibbaDB provides a **zero-friction, code-first migration system** that automatically handles schema changes when you bump version numbers in your code. No SQL files, no CLI commands, no separate migration tracking—just update your schema and restart your app.

## Quick Start

### 1. Basic Schema with Version

```typescript
import { z } from 'zod';
import { createDB } from 'skibbadb';

const db = createDB({ memory: true });

// Define schema with version
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Create collection with version 1 (default)
const users = db.collection('users', UserSchema, { version: 1 });
```

### 2. Schema Evolution

When you need to add fields, simply update your schema and bump the version:

```typescript
// Version 2 - Add optional fields
const UserSchemaV2 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),        // ✅ Safe to add
  avatar: z.string().optional(),     // ✅ Safe to add
});

const users = db.collection('users', UserSchemaV2, { version: 2 });
```

**On app restart**: SkibbaDB automatically generates and runs:
```sql
ALTER TABLE users ADD COLUMN age REAL;
ALTER TABLE users ADD COLUMN avatar TEXT;
```

## Migration Rules

### ✅ **Safe (Automatic) Changes**
These changes are automatically handled by ALTER statements:

- **Adding optional fields**: `z.string().optional()`
- **Adding nullable fields**: `z.string().nullable()`
- **Adding fields with union including null**: `z.union([z.string(), z.null()])`

### ❌ **Breaking (Manual) Changes**
These require manual intervention and will throw an error:

- **Removing fields**: Deleting properties from schema
- **Changing field types**: `z.string()` → `z.number()`
- **Making optional fields required**: `z.string().optional()` → `z.string()`

## Advanced Usage

### Migration Status

Check the current state of all migrations:

```typescript
const status = await db.getMigrationStatus();
console.log(status);
// [
//   {
//     collectionName: 'users',
//     version: 2,
//     completedAlters: [
//       'ALTER TABLE users ADD COLUMN age REAL',
//       'ALTER TABLE users ADD COLUMN avatar TEXT'
//     ]
//   }
// ]
```

### Dry-Run Mode

Preview migrations without executing them:

```typescript
// Set environment variable
process.env.SKIBBADB_MIGRATE = 'print';

// Create collection - will print migration plan instead of executing
const users = db.collection('users', UserSchemaV2, { version: 2 });
// Console output:
// Migration plan for users (v1 → v2):
//   ALTER TABLE users ADD COLUMN age REAL;
//   ALTER TABLE users ADD COLUMN avatar TEXT;
```

### Branch Safety & Rollbacks

SkibbaDB handles git branch switching gracefully:

- **Branch with higher version** → **Branch with lower version**: No action taken
- **No automatic downgrades**: Prevents data loss
- **Forward compatibility**: Old code ignores new columns

```typescript
// main branch: version 3
const users = db.collection('users', UserSchemaV3, { version: 3 });

// Switch to feature branch: version 2
const users = db.collection('users', UserSchemaV2, { version: 2 });
// ℹ️ Warning logged, no migration runs, extra columns ignored
```

## Type Mapping

SkibbaDB automatically maps Zod types to SQL types:

| Zod Type | SQL Type | Example |
|----------|----------|---------|
| `z.string()` | `TEXT` | `name: z.string()` |
| `z.number()` | `REAL` | `price: z.number()` |
| `z.bigint()` | `INTEGER` | `id: z.bigint()` |
| `z.boolean()` | `INTEGER` | `active: z.boolean()` |
| `z.date()` | `TEXT` | `createdAt: z.date()` |
| `z.array()` | `TEXT` | `tags: z.array(z.string())` |
| `z.object()` | `TEXT` | `metadata: z.object({})` |

## Real-World Example

Here's a complete example showing schema evolution over time:

```typescript
import { z } from 'zod';
import { createDB } from 'skibbadb';

const db = createDB({ path: './app.db' });

// Version 1: Basic user schema
const UserSchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Version 2: Add optional profile fields
const UserSchemaV2 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(),
  bio: z.string().optional(),
});

// Version 3: Add preferences and timestamps
const UserSchemaV3 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(),
  bio: z.string().optional(),
  preferences: z.object({
    theme: z.enum(['light', 'dark']),
    notifications: z.boolean(),
  }).optional(),
  createdAt: z.date().optional(),
  lastLoginAt: z.date().optional(),
});

// Use latest version
const users = db.collection('users', UserSchemaV3, { version: 3 });

// Works with all data regardless of when it was created
const allUsers = await users.toArray();
```

## Migration Metadata

SkibbaDB stores migration information in the `_skibbadb_migrations` table:

```sql
CREATE TABLE _skibbadb_migrations (
  collection_name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  completed_alters TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

You can query this directly if needed:

```typescript
const migrationData = await db.query(
  "SELECT * FROM _skibbadb_migrations WHERE collection_name = ?",
  ['users']
);
```

## Error Handling

### Breaking Changes

```typescript
// This will throw an error:
const UserSchemaBreaking = z.object({
  id: z.string(),
  name: z.string(),
  // email field removed - BREAKING!
  age: z.number(), // changed from optional to required - BREAKING!
});

try {
  const users = db.collection('users', UserSchemaBreaking, { version: 4 });
} catch (error) {
  console.error(error.message);
  // "Breaking schema migration required for collection 'users' (v3 → v4): 
  // Field 'email' was removed, Field 'age' type changed from REAL to INTEGER. 
  // Manual migration required."
}
```

### Manual Migration for Breaking Changes

When you encounter breaking changes, you have options:

1. **Create a new collection** with the new schema
2. **Write a custom migration script** to transform data
3. **Use SQL directly** to modify the table structure

```typescript
// Option 1: New collection approach
const usersV2 = db.collection('users_v2', NewUserSchema, { version: 1 });

// Migrate data manually
const oldUsers = await users.toArray();
for (const user of oldUsers) {
  const transformedUser = transformUserData(user);
  await usersV2.insert(transformedUser);
}
```

## Best Practices

### 1. **Always Use Optional for New Fields**

```typescript
// ✅ Good: New fields are optional
const UserSchemaV2 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(), // New field is optional
});
```

### 2. **Increment Versions Sequentially**

```typescript
// ✅ Good: Sequential versioning
version: 1 → version: 2 → version: 3

// ❌ Avoid: Jumping versions
version: 1 → version: 5
```

### 3. **Test Migrations in Development**

```typescript
// Use dry-run mode first
process.env.SKIBBADB_MIGRATE = 'print';
const users = db.collection('users', NewSchema, { version: 2 });

// Then run actual migration
delete process.env.SKIBBADB_MIGRATE;
const users = db.collection('users', NewSchema, { version: 2 });
```

### 4. **Document Schema Changes**

```typescript
// Version history:
// v1: Basic user (id, name, email)
// v2: Added avatar, bio
// v3: Added preferences, timestamps
const UserSchema = z.object({
  // ... schema definition
});

const users = db.collection('users', UserSchema, { version: 3 });
```

### 5. **Handle Deployment Safely**

For production deployments with multiple instances:

1. Deploy new code with higher version
2. Let migrations run automatically
3. Old instances ignore new columns gracefully
4. No downtime required

## CLI Integration (Future)

While not implemented yet, you could easily add CLI commands:

```bash
# View migration status
bun run skibbadb migrate:status

# Dry-run pending migrations  
bun run skibbadb migrate:plan

# Force migration for collection
bun run skibbadb migrate:run users
```

## Performance Considerations

- **Migrations run once per version bump**: Subsequent restarts are instant
- **ALTER TABLE operations**: Generally fast, but large tables may take time
- **Rollback safety**: No data loss on version downgrades
- **Concurrent access**: Migrations use transactions for consistency

## Troubleshooting

### Migration Stuck or Failed

```typescript
// Check migration status
const status = await db.getMigrationStatus();
console.log(status);

// Reset migration (use with caution)
await db.exec("DELETE FROM _skibbadb_migrations WHERE collection_name = ?", ['users']);
```

### Version Conflicts

```typescript
// If you get version conflicts between team members:
// 1. Coordinate version numbers in advance
// 2. Use feature branch versioning strategy
// 3. Reset development databases when needed
```

---

The migration system in SkibbaDB provides the perfect balance of automation and safety, making schema evolution as simple as updating your TypeScript types and bumping a version number.