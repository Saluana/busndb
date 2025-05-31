import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { createDB, ValidationError, UniqueConstraintError, NotFoundError } from '../src/index.js';
import type { Database } from '../src/database.js';

const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().optional()
});

const postSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.string().uuid(),
  createdAt: z.date().default(() => new Date())
});

describe('BusNDB', () => {
  let db: Database;

  beforeEach(() => {
    db = createDB({ memory: true });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Database Creation', () => {
    test('should create in-memory database', () => {
      expect(db).toBeDefined();
      expect(db.listCollections()).toEqual([]);
    });

    test('should create database with file path', () => {
      const fileDb = createDB({ path: ':memory:' });
      expect(fileDb).toBeDefined();
      fileDb.close();
    });
  });

  describe('Collection Management', () => {
    test('should create collection with schema', () => {
      const users = db.collection('users', userSchema);
      expect(users).toBeDefined();
      expect(db.listCollections()).toContain('users');
    });

    test('should get existing collection', () => {
      db.collection('users', userSchema);
      const users = db.collection('users');
      expect(users).toBeDefined();
    });

    test('should throw error for duplicate collection', () => {
      db.collection('users', userSchema);
      expect(() => {
        db.collection('users', userSchema);
      }).toThrow('Collection \'users\' already exists');
    });

    test('should throw error for non-existent collection', () => {
      expect(() => {
        db.collection('nonexistent');
      }).toThrow('Collection \'nonexistent\' not found');
    });
  });

  describe('Document Operations', () => {
    let users: ReturnType<typeof db.collection<typeof userSchema>>;

    beforeEach(() => {
      users = db.collection('users', userSchema);
    });

    test('should insert document', () => {
      const user = users.insertSync({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      });

      expect(user.id).toBeDefined();
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
      expect(user.age).toBe(30);
    });

    test('should validate document on insert', () => {
      expect(() => {
        users.insertSync({
          name: 'Invalid User',
          email: 'invalid-email',
          age: 30
        } as any);
      }).toThrow(ValidationError);
    });

    test('should insert bulk documents', () => {
      const docs = [
        { name: 'User 1', email: 'user1@example.com' },
        { name: 'User 2', email: 'user2@example.com' }
      ];

      const inserted = users.insertBulkSync(docs);
      expect(inserted).toHaveLength(2);
      expect(inserted[0].id).toBeDefined();
      expect(inserted[1].id).toBeDefined();
    });

    test('should find document by id', () => {
      const user = users.insertSync({
        name: 'John Doe',
        email: 'john@example.com'
      });

      const found = users.findByIdSync(user.id);
      expect(found).toEqual(user);
    });

    test('should return null for non-existent document', () => {
      const found = users.findByIdSync('non-existent-id');
      expect(found).toBeNull();
    });

    test('should update document', () => {
      const user = users.insertSync({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      });

      const updated = users.putSync(user.id, { age: 31 });
      expect(updated.age).toBe(31);
      expect(updated.name).toBe('John Doe');
    });

    test('should throw error when updating non-existent document', () => {
      expect(() => {
        users.putSync('non-existent-id', { name: 'Updated' });
      }).toThrow(NotFoundError);
    });

    test('should delete document', () => {
      const user = users.insertSync({
        name: 'John Doe',
        email: 'john@example.com'
      });

      const deleted = users.deleteSync(user.id);
      expect(deleted).toBe(true);
      expect(users.findByIdSync(user.id)).toBeNull();
    });

    test('should delete bulk documents', () => {
      const user1 = users.insertSync({ name: 'User 1', email: 'user1@example.com' });
      const user2 = users.insertSync({ name: 'User 2', email: 'user2@example.com' });

      const count = users.deleteBulkSync([user1.id, user2.id]);
      expect(count).toBe(2);
    });
  });

  describe('Querying', () => {
    let users: ReturnType<typeof db.collection<typeof userSchema>>;

    beforeEach(() => {
      users = db.collection('users', userSchema);
      
      // Insert test data
      users.insertBulkSync([
        { name: 'Alice', email: 'alice@example.com', age: 25 },
        { name: 'Bob', email: 'bob@example.com', age: 30 },
        { name: 'Charlie', email: 'charlie@example.com', age: 35 }
      ]);
    });

    test('should get all documents', () => {
      const allUsers = users.toArraySync();
      expect(allUsers).toHaveLength(3);
    });

    test('should filter by equality', () => {
      const result = users.where('name').eq('Alice').toArraySync();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });

    test('should filter by comparison operators', () => {
      const result = users.where('age').gte(30).toArraySync();
      expect(result).toHaveLength(2);
      expect(result.every(u => u.age! >= 30)).toBe(true);
    });

    test('should filter by multiple conditions', () => {
      const result = users.where('age').gte(25).and().where('age').lt(35).toArraySync();
      expect(result).toHaveLength(2);
    });

    test('should order results', () => {
      const result = users.where('age').gte(20).orderBy('age', 'desc').toArraySync();
      expect(result[0].age).toBe(35);
      expect(result[1].age).toBe(30);
      expect(result[2].age).toBe(25);
    });

    test('should limit results', () => {
      const result = users.where('age').gte(20).limit(2).toArraySync();
      expect(result).toHaveLength(2);
    });

    test('should get first result', () => {
      const result = users.where('name').eq('Bob').firstSync();
      expect(result?.name).toBe('Bob');
    });

    test('should count results', () => {
      const count = users.where('age').gte(30).countSync();
      expect(count).toBe(2);
    });

    test('should filter by in operator', () => {
      const result = users.where('name').in(['Alice', 'Bob']).toArraySync();
      expect(result).toHaveLength(2);
    });
  });

  describe('Transactions', () => {
    let users: ReturnType<typeof db.collection<typeof userSchema>>;

    beforeEach(() => {
      users = db.collection('users', userSchema);
    });

    test('should execute transaction successfully', async () => {
      const result = await db.transaction(async () => {
        users.insertSync({ name: 'User 1', email: 'user1@example.com' });
        users.insertSync({ name: 'User 2', email: 'user2@example.com' });
        return 'success';
      });

      expect(result).toBe('success');
      expect(users.toArraySync()).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle validation errors', () => {
      const users = db.collection('users', userSchema);
      
      expect(() => {
        users.insertSync({ name: '', email: 'invalid' } as any);
      }).toThrow(ValidationError);
    });
  });
});

describe('Driver Initialization and Error Handling', () => {
  test('ensureDriver should reject with DatabaseError if createDriver throws', async () => {
    // Use sharedConnection: true for lazy initialization, so ensureDriver calls createDriver.
    // Provide an invalid driver name to make createDriver throw.
    // Also, ensure this db instance is separate and doesn't use global beforeEach/afterEach if they assume successful creation.
    let errorDb: Database | undefined;
    try {
      errorDb = createDB({ driver: 'invalid-driver-name' as any, sharedConnection: true });

      // Calling exec will trigger ensureDriver, which will then attempt to create the driver.
      const action = () => errorDb!.exec('SELECT 1');

      // Using .toReject().then() for detailed checks on the error instance
      await expect(action())
        .toReject()
        .then((error: any) => {
          expect(error).toBeInstanceOf(DatabaseError);
          if (error instanceof DatabaseError) { // type guard
            expect(error.code).toBe('DRIVER_CREATION_FAILED');
            // This message comes from createDriver's "Unknown driver" error, wrapped by ensureDriver's message
            expect(error.message).toBe('Failed to create dedicated driver: Unknown driver: invalid-driver-name');
          } else {
            // Fail test if not DatabaseError (though toBeInstanceOf should catch this)
            expect(true).toBe(false);
          }
        });
    } finally {
      if (errorDb) {
        try {
          // This close might also fail if driver never initialized, so wrap it.
          await errorDb.close();
        } catch { /* ignore cleanup error */ }
      }
    }
  });
});
