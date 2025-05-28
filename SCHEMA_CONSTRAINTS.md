# Schema Constraints System

This document describes the comprehensive schema constraint system implemented for BusNDB, providing developers with powerful data integrity and relationship management capabilities.

## Overview

The schema constraint system extends Zod schemas with database-level constraints including:

- **Unique Constraints**: Enforce uniqueness on single or multiple fields
- **Foreign Key Constraints**: Validate relationships between collections
- **Index Management**: Automatic index creation for optimized queries
- **Composite Constraints**: Complex constraints spanning multiple fields

## API Reference

### Constraint Helper Functions

```typescript
import { unique, foreignKey, index, compositeUnique } from './schema-constraints';

// Unique constraint on single field
const emailConstraint = unique('unique_email_constraint');

// Foreign key constraint
const organizationConstraint = foreignKey('organizations', 'id', {
    onDelete: 'cascade',
    onUpdate: 'restrict'
});

// Index for performance
const emailIndex = index('email', { unique: true });

// Composite unique constraint
const userOrgConstraint = compositeUnique(['userId', 'organizationId']);
```

### Collection Definition with Constraints

```typescript
const users = db.collection('users', userSchema, {
    constraints: {
        // Field-level constraints
        constraints: {
            email: unique(),
            username: unique('unique_username'),
            organizationId: foreignKey('organizations', 'id'),
            userOrg: compositeUnique(['userId', 'organizationId']),
        },
        
        // Indexes for performance
        indexes: {
            email: index('email'),
            username: index('username'),
            organizationId: index('organizationId'),
            createdAt: index('createdAt'),
        },
    },
});
```

## Constraint Types

### 1. Unique Constraints

Ensure field values are unique across the collection.

```typescript
// Single field unique constraint
email: unique()
email: unique('custom_constraint_name')

// Composite unique constraint
userRole: compositeUnique(['userId', 'roleId'], 'user_role_unique')
```

**Features:**
- Supports single and composite field uniqueness
- Allows NULL values (multiple NULLs are permitted)
- Validates on both insert and update operations
- Provides meaningful error messages with field information

### 2. Foreign Key Constraints

Validate relationships between collections at the application level.

```typescript
// Basic foreign key
organizationId: foreignKey('organizations', 'id')

// Foreign key with cascade options
parentId: foreignKey('categories', 'id', {
    onDelete: 'cascade',
    onUpdate: 'restrict'
})

// Composite foreign key
composite: compositeForeignKey(
    ['userId', 'roleId'],
    'user_roles',
    ['user_id', 'role_id']
)
```

**Features:**
- Application-level validation (SQLite limitation with JSON fields)
- Support for cascade operations (planned)
- Validates referenced records exist before insert/update
- Composite foreign key support

### 3. Index Management

Automatic index creation for optimized query performance.

```typescript
// Simple index
createdAt: index('createdAt')

// Named index
email: index('email', { name: 'idx_user_email' })

// Unique index
username: index('username', { unique: true })

// Partial index (planned)
activeUsers: index('isActive', { 
    partial: 'isActive = true' 
})
```

**Features:**
- Automatic SQL index generation
- Support for single and composite field indexes
- Unique index support
- JSON field path extraction for SQLite compatibility

## Implementation Details

### SQL Generation

The system generates optimized SQLite queries using JSON field extraction:

```sql
-- Unique constraint becomes:
CREATE UNIQUE INDEX user_email_unique ON users (json_extract(doc, '$.email'))

-- Foreign key validation becomes:
SELECT COUNT(*) FROM organizations WHERE json_extract(doc, '$.id') = ?

-- Composite unique constraint becomes:
SELECT COUNT(*) FROM memberships 
WHERE json_extract(doc, '$.userId') = ? 
  AND json_extract(doc, '$.organizationId') = ?
```

### Validation Flow

1. **Document Validation**: Zod schema validation
2. **Unique Constraint Check**: Query existing records for duplicates
3. **Foreign Key Validation**: Verify referenced records exist
4. **SQL Execution**: Insert/update with error handling

### Error Handling

The system provides specific error types with detailed information:

```typescript
try {
    users.insert(duplicateUser);
} catch (error) {
    if (error instanceof UniqueConstraintError) {
        console.log(`Field: ${error.field}`);
        console.log(`Value: ${error.message}`);
    }
}
```

## Usage Examples

### Basic Setup

```typescript
import { z } from 'zod';
import { Database } from './database';
import { unique, foreignKey, index } from './schema-constraints';

const db = new Database({ path: './app.db' });

const userSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    username: z.string(),
    organizationId: z.string(),
    createdAt: z.date(),
});

const users = db.collection('users', userSchema, {
    constraints: {
        constraints: {
            email: unique(),
            username: unique(),
            organizationId: foreignKey('organizations', 'id'),
        },
        indexes: {
            email: index('email'),
            organizationId: index('organizationId'),
            createdAt: index('createdAt'),
        },
    },
});
```

### Complex Relationships

```typescript
// Many-to-many relationship with composite unique constraint
const memberships = db.collection('memberships', membershipSchema, {
    constraints: {
        constraints: {
            userId: foreignKey('users', 'id'),
            organizationId: foreignKey('organizations', 'id'),
            userOrg: compositeUnique(['userId', 'organizationId']),
        },
        indexes: {
            userId: index('userId'),
            organizationId: index('organizationId'),
            role: index('role'),
        },
    },
});
```

## Performance Considerations

1. **Index Usage**: All constraint validations are optimized with appropriate indexes
2. **Query Efficiency**: Unique checks use COUNT queries with early termination
3. **Batch Operations**: Constraints are validated per-document in bulk operations
4. **JSON Extraction**: SQLite json_extract() is used for efficient field access

## Limitations and Future Enhancements

### Current Limitations

1. **Check Constraints**: Not yet implemented due to SQLite JSON field complexity
2. **Cascade Operations**: Foreign key cascades are planned but not implemented
3. **Cross-Collection Transactions**: Complex constraint validation across collections

### Planned Features

1. **Application-level Check Constraints**: Custom validation functions
2. **Cascade Delete/Update**: Automatic related record management
3. **Constraint Triggers**: Custom hooks for constraint violations
4. **Performance Monitoring**: Constraint validation metrics

## Best Practices

1. **Index Strategy**: Create indexes for all frequently queried fields
2. **Constraint Naming**: Use descriptive names for complex constraints
3. **Error Handling**: Implement specific error handling for constraint violations
4. **Performance Testing**: Monitor constraint validation performance in production
5. **Schema Migration**: Plan constraint changes carefully to avoid data issues

## Integration with TypeScript

The constraint system maintains full TypeScript compatibility:

```typescript
// Type-safe constraint definition
type UserConstraints = {
    email: UniqueConstraint;
    organizationId: ForeignKeyConstraint;
};

// Inferred schema types work with constraints
type User = InferSchema<typeof userSchema>; // Includes constraint validation
```

This schema constraint system provides a robust foundation for data integrity while maintaining the flexibility and performance characteristics of a NoSQL document store.