# Schema Migrations & Versioning

SkibbaDB provides a **zero-friction, code-first migration system** that automatically handles schema changes when you bump version numbers in your code. No SQL files, no CLI commands, no separate migration tracking—just update your schema and restart your app.

## Custom Upgrade Functions

Beyond automatic schema migrations, SkibbaDB provides **custom upgrade functions** for complex data transformations, validation, and business logic that can't be handled by simple ALTER TABLE statements.

### Basic Usage

```typescript
import { z } from 'zod';
import { createDB } from 'skibbadb';

const db = createDB({ path: './app.db' });

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  fullName: z.string().optional(), // New computed field
});

const users = db.collection('users', UserSchema, {
  version: 3,
  upgrade: {
    2: async (collection, ctx) => {
      // v1 → v2: Add email validation and normalization
      const users = await collection.toArray();
      
      for (const user of users) {
        if (!user.email || !user.email.includes('@')) {
          await collection.put(user.id, {
            ...user,
            email: `${user.name.toLowerCase().replace(' ', '.')}@example.com`
          });
        }
      }
    },
    3: async (collection, ctx) => {
      // v2 → v3: Generate fullName from existing data
      const users = await collection.toArray();
      
      for (const user of users) {
        if (!user.fullName) {
          await collection.put(user.id, {
            ...user,
            fullName: user.name
          });
        }
      }
    }
  }
});
```

### Upgrade Context

Upgrade functions receive a powerful context object with database access:

```typescript
const users = db.collection('users', UserSchema, {
  version: 2,
  upgrade: {
    2: async (collection, ctx) => {
      console.log(`Upgrading from v${ctx.fromVersion} to v${ctx.toVersion}`);
      
      // Access other collections
      const profiles = ctx.database.collection('profiles', ProfileSchema);
      
      // Execute raw SQL
      await ctx.exec(`
        UPDATE users 
        SET doc = JSON_SET(doc, '$.processed', 1)
        WHERE JSON_EXTRACT(doc, '$.processed') IS NULL
      `);
      
      // Query with raw SQL
      const results = await ctx.sql('SELECT COUNT(*) as count FROM users');
      console.log(`Processed ${results[0].count} users`);
    }
  }
});
```

### Conditional Upgrades

Run upgrades only when certain conditions are met:

```typescript
const users = db.collection('users', UserSchema, {
  version: 3,
  upgrade: {
    2: {
      condition: async (collection) => {
        // Only run if there are users without email
        const count = await collection
          .where('email').exists().not()
          .count();
        return count > 0;
      },
      migrate: async (collection, ctx) => {
        // Migration logic here
        const users = await collection
          .where('email').exists().not()
          .toArray();
        
        for (const user of users) {
          await collection.put(user.id, {
            ...user,
            email: `${user.name.toLowerCase()}@example.com`
          });
        }
      }
    },
    3: async (collection, ctx) => {
      // This always runs
      console.log('Always running upgrade v3');
    }
  }
});
```

### Sequential Execution

Upgrade functions run sequentially in version order:

```typescript
const users = db.collection('users', UserSchema, {
  version: 4,
  upgrade: {
    2: async (collection) => {
      console.log('Running upgrade v2');
      await collection.insert({ name: 'Test User' });
    },
    3: async (collection) => {
      console.log('Running upgrade v3');
      const users = await collection.toArray();
      // Process the user created in v2
    },
    4: async (collection) => {
      console.log('Running upgrade v4');
      // Final transformations
    }
  }
});
```

### Cross-Collection Migrations

Access other collections during upgrades:

```typescript
const users = db.collection('users', UserSchema, {
  version: 2,
  upgrade: {
    2: async (collection, { database }) => {
      // Create profiles collection
      const profiles = database.collection('profiles', ProfileSchema, { version: 1 });
      
      // Create profile for each existing user
      const users = await collection.toArray();
      for (const user of users) {
        const existingProfile = await profiles.findById(user.id);
        
        if (!existingProfile) {
          await profiles.insert({
            id: user.id,
            userId: user.id,
            bio: `Profile for ${user.name}`,
            avatar: null,
            createdAt: new Date()
          });
        }
      }
    }
  }
});
```

### Seed Functions

Initialize collections with default data:

```typescript
const users = db.collection('users', UserSchema, {
  version: 1,
  seed: async (collection) => {
    // Only runs for new collections (version 0 → 1)
    await collection.insert({
      name: 'Admin User',
      email: 'admin@example.com',
      role: 'admin'
    });
    
    await collection.insert({
      name: 'Guest User', 
      email: 'guest@example.com',
      role: 'guest'
    });
  }
});
```

### Bulk Operations with SQL

For performance-critical migrations, use raw SQL:

```typescript
const posts = db.collection('posts', PostSchema, {
  version: 2,
  upgrade: {
    2: async (collection, { exec }) => {
      // Bulk update using SQL
      await exec(`
        UPDATE posts 
        SET doc = JSON_SET(
          doc, 
          '$.slug', 
          LOWER(REPLACE(JSON_EXTRACT(doc, '$.title'), ' ', '-'))
        )
        WHERE JSON_EXTRACT(doc, '$.slug') IS NULL
      `);
      
      // Remove duplicate posts by title
      await exec(`
        DELETE FROM posts 
        WHERE rowid NOT IN (
          SELECT MIN(rowid) 
          FROM posts 
          GROUP BY JSON_EXTRACT(doc, '$.title')
        )
      `);
    }
  }
});
```

### Data Transformation Example

Transform complex data structures:

```typescript
const UserSchemaV3 = z.object({
  id: z.string(),
  name: z.string(), 
  email: z.string(),
  preferences: z.object({
    theme: z.enum(['light', 'dark']),
    notifications: z.boolean(),
    language: z.string()
  }).optional()
});

const users = db.collection('users', UserSchemaV3, {
  version: 3,
  upgrade: {
    3: async (collection) => {
      // Convert string preferences to object
      const users = await collection.toArray();
      
      for (const user of users) {
        // Assume preferences were stored as string like 'dark,true,en'
        if (typeof user.preferences === 'string') {
          const [theme, notifications, language] = user.preferences.split(',');
          
          await collection.put(user.id, {
            ...user,
            preferences: {
              theme: theme === 'dark' ? 'dark' : 'light',
              notifications: notifications === 'true',
              language: language || 'en'
            }
          });
        }
      }
    }
  }
});
```

### Error Handling

Upgrade functions run in transactions and will rollback on errors:

```typescript
const users = db.collection('users', UserSchema, {
  version: 2,
  upgrade: {
    2: async (collection, ctx) => {
      try {
        // Migration logic
        const users = await collection.toArray();
        
        for (const user of users) {
          if (!user.email) {
            throw new Error(`User ${user.id} missing email`);
          }
          // Process user...
        }
      } catch (error) {
        console.error('Upgrade v2 failed:', error);
        throw error; // Will rollback the transaction
      }
    }
  }
});
```

### Dry-Run Mode

Preview upgrade functions without executing them:

```typescript
// Set environment variable to preview migrations
process.env.SKIBBADB_MIGRATE = 'print';

const users = db.collection('users', UserSchemaV2, {
  version: 2,
  upgrade: {
    2: async (collection) => {
      // This will be printed but not executed
      console.log('Would run upgrade v2');
    }
  }
});

// Console output:
// Migration plan for users (v1 → v2):
//   ALTER TABLE users ADD COLUMN email TEXT;
//   Custom upgrade functions for users:
//     v2: Custom migration function
```

### Best Practices

#### 1. **Keep Upgrades Idempotent**
```typescript
upgrade: {
  2: async (collection) => {
    // Check if work is already done
    const unprocessed = await collection
      .where('processed').exists().not()
      .toArray();
    
    // Only process unprocessed records
    for (const item of unprocessed) {
      await collection.put(item.id, { ...item, processed: true });
    }
  }
}
```

#### 2. **Use Conditional Upgrades for Optional Work**
```typescript
upgrade: {
  2: {
    condition: async (collection) => {
      const needsUpgrade = await collection
        .where('needsProcessing').eq(true)
        .count();
      return needsUpgrade > 0;
    },
    migrate: async (collection) => {
      // Only runs if condition is true
    }
  }
}
```

#### 3. **Handle Large Datasets in Batches**
```typescript
upgrade: {
  2: async (collection) => {
    const batchSize = 1000;
    let offset = 0;
    
    while (true) {
      const batch = await collection
        .where('processed').exists().not()
        .limit(batchSize)
        .offset(offset)
        .toArray();
      
      if (batch.length === 0) break;
      
      for (const item of batch) {
        await collection.put(item.id, { ...item, processed: true });
      }
      
      offset += batchSize;
    }
  }
}
```

#### 4. **Log Progress for Long Operations**
```typescript
upgrade: {
  2: async (collection) => {
    const total = await collection.count();
    let processed = 0;
    
    const users = await collection.toArray();
    
    for (const user of users) {
      // Process user...
      processed++;
      
      if (processed % 100 === 0) {
        console.log(`Processed ${processed}/${total} users`);
      }
    }
  }
}
```

### Migration Order

When you create a collection, the following happens automatically:

1. **Schema Analysis**: Compare stored version with schema version
2. **Automatic Migrations**: Run ALTER TABLE statements for schema changes  
3. **Custom Upgrades**: Execute upgrade functions sequentially
4. **Seed Data**: Run seed function for new collections (version 0 → 1)
5. **Version Update**: Mark migration as complete

This provides the perfect balance of automatic schema evolution with the power to handle complex data transformations when needed.

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