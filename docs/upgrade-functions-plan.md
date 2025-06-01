# Schema Upgrade Functions - Implementation Plan

This document outlines a plan to implement custom upgrade functions for SkibbaDB schema migrations, similar to Dexie's upgrade system.

## 🎯 Goals

1. **Custom Migration Logic**: Allow users to define functions that run during schema upgrades
2. **Data Transformation**: Enable complex data migrations beyond simple ALTER TABLE statements
3. **Version-Specific Upgrades**: Run different logic for each version transition
4. **Transaction Safety**: Ensure all upgrade operations are atomic
5. **Backward Compatibility**: Work alongside existing automatic migrations

## 🏗️ Proposed API Design

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
    2: async (collection, migrator) => {
      // v1 → v2: Add email validation
      const invalidUsers = await collection
        .where('email').not().contains('@')
        .toArray();
      
      for (const user of invalidUsers) {
        await collection.put(user.id, {
          ...user,
          email: `${user.name.toLowerCase()}@example.com`
        });
      }
    },
    3: async (collection, migrator) => {
      // v2 → v3: Generate fullName from existing data
      const users = await collection.toArray();
      
      for (const user of users) {
        if (!user.fullName) {
          await collection.put(user.id, {
            ...user,
            fullName: user.name // Simple transformation
          });
        }
      }
    }
  }
});
```

### Advanced Usage with Migration Context

```typescript
const users = db.collection('users', UserSchema, {
  version: 4,
  upgrade: {
    2: async (collection, { fromVersion, toVersion, database, transaction }) => {
      console.log(`Upgrading users from v${fromVersion} to v${toVersion}`);
      
      // Access other collections
      const profiles = database.collection('profiles');
      
      // Run in transaction context
      await transaction(async () => {
        const users = await collection.toArray();
        
        for (const user of users) {
          // Create corresponding profile
          await profiles.insert({
            userId: user.id,
            bio: '',
            avatar: null
          });
        }
      });
    },
    3: async (collection, ctx) => {
      // Bulk operations for performance
      await ctx.database.exec(`
        UPDATE users 
        SET fullName = name 
        WHERE fullName IS NULL
      `);
    },
    4: async (collection, ctx) => {
      // Complex data migration with external API
      const users = await collection.toArray();
      
      for (const user of users) {
        if (!user.avatar) {
          const avatarUrl = await generateAvatar(user.email);
          await collection.put(user.id, {
            ...user,
            avatar: avatarUrl
          });
        }
      }
    }
  }
});
```

### Conditional Upgrades

```typescript
const users = db.collection('users', UserSchema, {
  version: 3,
  upgrade: {
    2: {
      condition: async (collection) => {
        // Only run if there are users without fullName
        const count = await collection
          .where('fullName').exists().not()
          .executeCount();
        return count > 0;
      },
      migrate: async (collection, ctx) => {
        // Migration logic here
      }
    },
    3: async (collection, ctx) => {
      // Always runs
    }
  }
});
```

## 📁 File Structure

```
src/
├── migrator.ts                 # Existing migrator
├── upgrade-runner.ts           # New upgrade function runner
├── upgrade-context.ts          # Migration context utilities
├── types.ts                    # Updated with upgrade types
└── collection.ts               # Updated to support upgrades
```

## 🔧 Implementation Plan

### Phase 1: Core Upgrade Types

```typescript
// src/upgrade-types.ts
export interface UpgradeContext {
  fromVersion: number;
  toVersion: number;
  database: Database;
  transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  migrator: Migrator;
  sql: (query: string, params?: any[]) => Promise<any[]>;
  exec: (query: string, params?: any[]) => Promise<void>;
}

export type UpgradeFunction<T> = (
  collection: Collection<T>,
  context: UpgradeContext
) => Promise<void>;

export interface ConditionalUpgrade<T> {
  condition?: (collection: Collection<T>) => Promise<boolean>;
  migrate: UpgradeFunction<T>;
}

export type UpgradeDefinition<T> = 
  | UpgradeFunction<T> 
  | ConditionalUpgrade<T>;

export interface UpgradeMap<T> {
  [version: number]: UpgradeDefinition<T>;
}
```

### Phase 2: Upgrade Runner

```typescript
// src/upgrade-runner.ts
export class UpgradeRunner {
  constructor(
    private driver: Driver,
    private database: Database
  ) {}

  async runUpgrades<T>(
    collection: Collection<T>,
    collectionSchema: CollectionSchema,
    fromVersion: number,
    toVersion: number
  ): Promise<void> {
    const { upgrade } = collectionSchema;
    
    if (!upgrade) return;

    // Run upgrades sequentially from fromVersion+1 to toVersion
    for (let version = fromVersion + 1; version <= toVersion; version++) {
      const upgradeDefinition = upgrade[version];
      
      if (upgradeDefinition) {
        await this.runSingleUpgrade(
          collection,
          upgradeDefinition,
          fromVersion,
          version
        );
      }
    }
  }

  private async runSingleUpgrade<T>(
    collection: Collection<T>,
    upgrade: UpgradeDefinition<T>,
    fromVersion: number,
    toVersion: number
  ): Promise<void> {
    const context: UpgradeContext = {
      fromVersion,
      toVersion,
      database: this.database,
      transaction: (fn) => this.driver.transaction(fn),
      migrator: new Migrator(this.driver),
      sql: (query, params) => this.driver.query(query, params),
      exec: (query, params) => this.driver.exec(query, params)
    };

    if (typeof upgrade === 'function') {
      // Simple function upgrade
      await this.driver.transaction(async () => {
        await upgrade(collection, context);
      });
    } else {
      // Conditional upgrade
      const shouldRun = upgrade.condition 
        ? await upgrade.condition(collection)
        : true;

      if (shouldRun) {
        await this.driver.transaction(async () => {
          await upgrade.migrate(collection, context);
        });
      }
    }
  }
}
```

### Phase 3: Updated Collection Schema

```typescript
// src/types.ts - Updated CollectionSchema
export interface CollectionSchema<T = any> {
  name: string;
  schema: z.ZodSchema<T>;
  primaryKey: string;
  version?: number;
  indexes?: string[];
  constraints?: SchemaConstraints;
  constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition };
  upgrade?: UpgradeMap<T>; // New field
  seed?: (collection: Collection<T>) => Promise<void>; // Bonus: seed data
}
```

### Phase 4: Integration with Migrator

```typescript
// src/migrator.ts - Updated checkAndRunMigration method
export class Migrator {
  // ... existing methods

  async checkAndRunMigration(
    collectionSchema: CollectionSchema,
    collection?: Collection<any>
  ): Promise<void> {
    const { name, version = 1, schema, upgrade } = collectionSchema;
    
    await this.initializeMigrationsTable();
    
    const storedVersion = await this.getStoredVersion(name);
    
    if (storedVersion === version) {
      return;
    }
    
    if (storedVersion > version) {
      console.warn(
        `Collection '${name}' has stored version ${storedVersion} which is higher than schema version ${version}. ` +
        `No migration will be performed.`
      );
      return;
    }

    // 1. Run automatic schema migrations (ALTER TABLE)
    let oldSchema: z.ZodSchema | null = null;
    if (storedVersion > 0) {
      oldSchema = schema; // We don't have old schema, so skip auto-migration for now
    }

    const diff = this.generateSchemaDiff(oldSchema, schema, name);
    
    if (process.env.SKIBBADB_MIGRATE === 'print') {
      console.log(`Migration plan for ${name} (v${storedVersion} → v${version}):`);
      if (diff.breaking) {
        console.log('  BREAKING CHANGES:', diff.breakingReasons.join(', '));
      }
      for (const alter of diff.alters) {
        console.log(`  ${alter}`);
      }
      
      if (upgrade && collection) {
        console.log('  Custom upgrade functions:');
        for (let v = storedVersion + 1; v <= version; v++) {
          if (upgrade[v]) {
            console.log(`    v${v}: Custom migration function`);
          }
        }
      }
      return;
    }

    await this.driver.transaction(async () => {
      // 2. Run automatic migrations first
      await this.runMigration(name, storedVersion, version, diff);
      
      // 3. Run custom upgrade functions
      if (upgrade && collection) {
        const upgradeRunner = new UpgradeRunner(this.driver, collection['database'] || this.driver);
        await upgradeRunner.runUpgrades(collection, collectionSchema, storedVersion, version);
      }
      
      // 4. Run seed function if this is a new collection
      if (storedVersion === 0 && collectionSchema.seed && collection) {
        await collectionSchema.seed(collection);
      }
    });
    
    if (diff.alters.length > 0 || upgrade) {
      console.log(`Migrated collection '${name}' from v${storedVersion} to v${version}`);
    }
  }
}
```

## 🎯 Usage Examples

### Example 1: Data Transformation

```typescript
// Migrate user preferences from string to object
const users = db.collection('users', UserSchemaV3, {
  version: 3,
  upgrade: {
    3: async (collection, ctx) => {
      const users = await collection
        .where('preferences').eq('dark')
        .toArray();
      
      for (const user of users) {
        await collection.put(user.id, {
          ...user,
          preferences: {
            theme: user.preferences, // 'dark' -> { theme: 'dark' }
            notifications: true
          }
        });
      }
    }
  }
});
```

### Example 2: Data Cleanup

```typescript
const posts = db.collection('posts', PostSchema, {
  version: 2,
  upgrade: {
    2: async (collection, { sql }) => {
      // Remove duplicate posts by title
      await sql(`
        DELETE FROM posts 
        WHERE rowid NOT IN (
          SELECT MIN(rowid) 
          FROM posts 
          GROUP BY title
        )
      `);
    }
  }
});
```

### Example 3: Cross-Collection Migration

```typescript
const users = db.collection('users', UserSchema, {
  version: 2,
  upgrade: {
    2: async (collection, { database }) => {
      const profiles = database.collection('profiles');
      const users = await collection.toArray();
      
      // Create profile for each user
      for (const user of users) {
        const existingProfile = await profiles.findById(user.id);
        
        if (!existingProfile) {
          await profiles.insert({
            id: user.id,
            bio: '',
            avatar: null,
            createdAt: new Date()
          });
        }
      }
    }
  }
});
```

## 🔄 Migration Order

1. **Schema Analysis**: Detect version changes
2. **Automatic Migrations**: Run ALTER TABLE statements
3. **Custom Upgrades**: Execute user-defined upgrade functions
4. **Version Update**: Mark migration as complete
5. **Seed Data**: Run seed function for new collections

## ⚠️ Error Handling

```typescript
const users = db.collection('users', UserSchema, {
  version: 3,
  upgrade: {
    2: async (collection, ctx) => {
      try {
        // Migration logic
      } catch (error) {
        console.error(`Migration v2 failed for collection users:`, error);
        // Transaction will rollback automatically
        throw error;
      }
    },
    3: {
      condition: async (collection) => {
        try {
          // Check if migration is needed
          return true;
        } catch (error) {
          console.warn('Condition check failed, skipping migration:', error);
          return false;
        }
      },
      migrate: async (collection, ctx) => {
        // Migration logic
      }
    }
  }
});
```

## 🚀 Benefits

1. **Powerful Migrations**: Handle complex data transformations
2. **Type Safety**: Full TypeScript support for upgrade functions
3. **Transaction Safety**: All upgrades run in transactions
4. **Flexible**: Conditional upgrades, cross-collection migrations
5. **Debuggable**: Clear error messages and dry-run support
6. **Performance**: Bulk operations and SQL access
7. **Backward Compatible**: Works with existing automatic migrations

## 📅 Implementation Timeline

- **Week 1**: Core types and UpgradeRunner
- **Week 2**: Integration with existing Migrator
- **Week 3**: Testing and error handling
- **Week 4**: Documentation and examples
- **Week 5**: Advanced features (conditional upgrades, seed functions)

This plan provides a comprehensive upgrade system that gives users full control over complex migrations while maintaining the simplicity of automatic schema changes for basic use cases.