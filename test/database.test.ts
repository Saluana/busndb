import { test, expect, describe, beforeEach } from 'bun:test';
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
      const user = users.insert({
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
        users.insert({
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

      const inserted = users.insertBulk(docs);
      expect(inserted).toHaveLength(2);
      expect(inserted[0].id).toBeDefined();
      expect(inserted[1].id).toBeDefined();
    });

    test('should find document by id', () => {
      const user = users.insert({
        name: 'John Doe',
        email: 'john@example.com'
      });

      const found = users.findById(user.id);
      expect(found).toEqual(user);
    });

    test('should return null for non-existent document', () => {
      const found = users.findById('non-existent-id');
      expect(found).toBeNull();
    });

    test('should update document', () => {
      const user = users.insert({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      });

      const updated = users.put(user.id, { age: 31 });
      expect(updated.age).toBe(31);
      expect(updated.name).toBe('John Doe');
    });

    test('should throw error when updating non-existent document', () => {
      expect(() => {
        users.put('non-existent-id', { name: 'Updated' });
      }).toThrow(NotFoundError);
    });

    test('should delete document', () => {
      const user = users.insert({
        name: 'John Doe',
        email: 'john@example.com'
      });

      const deleted = users.delete(user.id);
      expect(deleted).toBe(true);
      expect(users.findById(user.id)).toBeNull();
    });

    test('should delete bulk documents', () => {
      const user1 = users.insert({ name: 'User 1', email: 'user1@example.com' });
      const user2 = users.insert({ name: 'User 2', email: 'user2@example.com' });

      const count = users.deleteBulk([user1.id, user2.id]);
      expect(count).toBe(2);
    });
  });

  describe('Querying', () => {
    let users: ReturnType<typeof db.collection<typeof userSchema>>;

    beforeEach(() => {
      users = db.collection('users', userSchema);
      
      // Insert test data
      users.insertBulk([
        { name: 'Alice', email: 'alice@example.com', age: 25 },
        { name: 'Bob', email: 'bob@example.com', age: 30 },
        { name: 'Charlie', email: 'charlie@example.com', age: 35 }
      ]);
    });

    test('should get all documents', () => {
      const allUsers = users.toArray();
      expect(allUsers).toHaveLength(3);
    });

    test('should filter by equality', () => {
      const result = users.where('name').eq('Alice').toArray();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });

    test('should filter by comparison operators', () => {
      const result = users.where('age').gte(30).toArray();
      expect(result).toHaveLength(2);
      expect(result.every(u => u.age! >= 30)).toBe(true);
    });

    test('should filter by multiple conditions', () => {
      const result = users.where('age').gte(25).and().where('age').lt(35).toArray();
      expect(result).toHaveLength(2);
    });

    test('should order results', () => {
      const result = users.where('age').gte(20).orderBy('age', 'desc').toArray();
      expect(result[0].age).toBe(35);
      expect(result[1].age).toBe(30);
      expect(result[2].age).toBe(25);
    });

    test('should limit results', () => {
      const result = users.where('age').gte(20).limit(2).toArray();
      expect(result).toHaveLength(2);
    });

    test('should get first result', () => {
      const result = users.where('name').eq('Bob').first();
      expect(result?.name).toBe('Bob');
    });

    test('should count results', () => {
      const count = users.where('age').gte(30).count();
      expect(count).toBe(2);
    });

    test('should filter by in operator', () => {
      const result = users.where('name').in(['Alice', 'Bob']).toArray();
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
        users.insert({ name: 'User 1', email: 'user1@example.com' });
        users.insert({ name: 'User 2', email: 'user2@example.com' });
        return 'success';
      });

      expect(result).toBe('success');
      expect(users.toArray()).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle validation errors', () => {
      const users = db.collection('users', userSchema);
      
      expect(() => {
        users.insert({ name: '', email: 'invalid' } as any);
      }).toThrow(ValidationError);
    });
  });
});