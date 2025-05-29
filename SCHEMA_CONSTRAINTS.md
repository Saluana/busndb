# Schema Constraints System

This document describes the comprehensive schema constraint system implemented for BusNDB, providing developers with powerful data integrity and relationship management capabilities.

## Overview

The schema constraint system extends Zod schemas with database-level constraints including:

- **Unique Constraints**: Enforce uniqueness on individual fields
- **Type Constraints**: SQLite type mapping for optimized storage
- **Nullable Constraints**: Control null value handling
- **Automatic Indexing**: Optimized indexes for constrained fields

## API Reference

### Constraint Field Types

```typescript
// Simple field constraints
type ConstrainedField = {
    unique?: boolean;           // Enforce uniqueness
    nullable?: boolean;         // Allow null values
    type?: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB';  // SQLite type mapping
};

// Example field definitions
const fieldConstraints = {
    email: { unique: true, nullable: false, type: 'TEXT' },
    age: { type: 'INTEGER' },
    score: { type: 'REAL' },
    isActive: { nullable: false },
};
```

### Collection Definition with Constraints

```typescript
// Create collection with constrained fields
const users = db.collection('users', userSchema, {
    constrainedFields: {
        email: { unique: true, nullable: false },
        username: { unique: true, nullable: false },
        age: { type: 'INTEGER' },
        departmentId: { type: 'TEXT' },
    },
});
```

## Constraint Types

### 1. Unique Constraints

Ensure field values are unique across the collection.

```typescript
// Single field unique constraint
const users = db.collection('users', userSchema, {
    constrainedFields: {
        email: { unique: true, nullable: false },
        username: { unique: true },
    },
});
```

**Features:**
- Simple boolean flag for uniqueness
- Allows NULL values when nullable: true (multiple NULLs are permitted)
- Validates on both insert and update operations
- Provides meaningful error messages with field information

### 2. Type Constraints

Specify SQLite data types for optimized storage and indexing.

```typescript
// Type-specific constraints
const products = db.collection('products', productSchema, {
    constrainedFields: {
        price: { type: 'REAL' },        // Floating point numbers
        quantity: { type: 'INTEGER' },   // Whole numbers
        name: { type: 'TEXT' },         // Text strings
        data: { type: 'BLOB' },         // Binary data
    },
});
```

**Features:**
- SQLite type mapping for better performance
- Automatic index optimization based on type
- Validates data types at database level
- Improved query performance with proper types

### 3. Nullable Constraints

Control whether fields can contain null values.

```typescript
// Nullable field constraints
const users = db.collection('users', userSchema, {
    constrainedFields: {
        email: { nullable: false },      // Required field
        phone: { nullable: true },       // Optional field
        age: { nullable: false, type: 'INTEGER' },
    },
});
```

**Features:**
- Simple boolean flag for null handling
- Works with unique constraints
- Validates at insert and update time
- Clear error messages for null violations

## Implementation Details

### SQL Generation

The system generates optimized SQLite queries using JSON field extraction:

```sql
-- Unique constraint becomes:
CREATE UNIQUE INDEX user_email_unique ON users (json_extract(doc, '$.email'))

-- Type-specific index:
CREATE INDEX user_age_idx ON users (CAST(json_extract(doc, '$.age') AS INTEGER))

-- Nullable validation:
SELECT COUNT(*) FROM users WHERE json_extract(doc, '$.email') IS NULL
```

### Validation Flow

1. **Document Validation**: Zod schema validation
2. **Unique Constraint Check**: Query existing records for duplicates
3. **Nullable Validation**: Verify required fields are not null
4. **Type Validation**: Ensure fields match specified SQLite types
5. **SQL Execution**: Insert/update with error handling

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
import { createDB } from './index';

const db = createDB({ path: './app.db' });

const userSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    username: z.string(),
    age: z.number().int(),
    createdAt: z.date(),
});

const users = db.collection('users', userSchema, {
    constrainedFields: {
        email: { unique: true, nullable: false, type: 'TEXT' },
        username: { unique: true, nullable: false, type: 'TEXT' },
        age: { type: 'INTEGER', nullable: false },
    },
});
```

### Complex Constraints

```typescript
// Product catalog with multiple constraint types
const products = db.collection('products', productSchema, {
    constrainedFields: {
        sku: { unique: true, nullable: false, type: 'TEXT' },
        name: { nullable: false, type: 'TEXT' },
        price: { type: 'REAL', nullable: false },
        categoryId: { type: 'INTEGER' },
        inStock: { nullable: false },
        description: { type: 'TEXT' },
    },
});

// User profiles with mixed constraints
const profiles = db.collection('profiles', profileSchema, {
    constrainedFields: {
        userId: { unique: true, nullable: false, type: 'TEXT' },
        email: { unique: true, nullable: false, type: 'TEXT' },
        displayName: { type: 'TEXT' },
        age: { type: 'INTEGER' },
        bio: { type: 'TEXT', nullable: true },
    },
});
```

## Performance Considerations

1. **Index Usage**: Unique constraints automatically create optimized indexes
2. **Type Optimization**: SQLite type hints improve query performance
3. **Query Efficiency**: Unique checks use COUNT queries with early termination
4. **Batch Operations**: Constraints are validated per-document in bulk operations
5. **JSON Extraction**: SQLite json_extract() is used for efficient field access

## Limitations and Future Enhancements

### Current Limitations

1. **Composite Constraints**: Multiple field constraints not yet supported
2. **Custom Validators**: Custom validation functions not implemented
3. **Advanced Types**: Limited to basic SQLite types

### Planned Features

1. **Composite Unique Constraints**: Multi-field uniqueness validation
2. **Custom Validators**: User-defined constraint validation functions  
3. **Check Constraints**: Field value validation rules
4. **Performance Monitoring**: Constraint validation metrics

## Best Practices

1. **Type Specification**: Always specify types for fields that will be queried frequently
2. **Unique Constraints**: Use unique constraints for natural keys and business identifiers
3. **Nullable Strategy**: Be explicit about nullable vs non-nullable fields
4. **Error Handling**: Implement specific error handling for constraint violations
5. **Performance Testing**: Monitor constraint validation performance in production
6. **Schema Migration**: Plan constraint changes carefully to avoid data issues

## Integration with TypeScript

The constraint system maintains full TypeScript compatibility:

```typescript
// Type-safe constraint definition
type UserConstraints = {
    constrainedFields: {
        email: { unique: true; nullable: false; type: 'TEXT' };
        age: { type: 'INTEGER'; nullable: false };
    };
};

// Inferred schema types work with constraints
type User = z.infer<typeof userSchema>; // Full type safety

// Collection with typed constraints
const users: Collection<User> = db.collection('users', userSchema, {
    constrainedFields: {
        email: { unique: true, nullable: false, type: 'TEXT' },
        age: { type: 'INTEGER', nullable: false },
    },
});
```

This streamlined constraint system provides essential data integrity features while maintaining simplicity and performance characteristics of a NoSQL document store.