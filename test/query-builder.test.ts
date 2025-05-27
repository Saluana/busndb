import { test, expect, describe, beforeEach } from 'bun:test';
import { z } from 'zod';
import { createDB } from '../src/index.js';
import type { Database } from '../src/database.js';

const testSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int(),
  score: z.number(),
  isActive: z.boolean(),
  tags: z.array(z.string()),
  metadata: z.object({
    category: z.string(),
    priority: z.number()
  }).optional(),
  createdAt: z.date().default(() => new Date())
});

describe('Query Builder - Feature Complete Tests', () => {
  let db: Database;
  let collection: ReturnType<typeof db.collection<typeof testSchema>>;

  beforeEach(() => {
    db = createDB({ memory: true });
    collection = db.collection('test', testSchema);
    
    // Insert comprehensive test data
    const testData = [
      {
        name: 'Alice Smith',
        email: 'alice@example.com',
        age: 25,
        score: 850.5,
        isActive: true,
        tags: ['admin', 'developer'],
        metadata: { category: 'engineering', priority: 1 }
      },
      {
        name: 'Bob Johnson',
        email: 'bob@example.com',
        age: 30,
        score: 750.0,
        isActive: true,
        tags: ['user', 'manager'],
        metadata: { category: 'management', priority: 2 }
      },
      {
        name: 'Charlie Brown',
        email: 'charlie@example.com',
        age: 35,
        score: 680.25,
        isActive: false,
        tags: ['user'],
        metadata: { category: 'sales', priority: 3 }
      },
      {
        name: 'Diana Wilson',
        email: 'diana@example.com',
        age: 28,
        score: 920.75,
        isActive: true,
        tags: ['admin', 'architect'],
        metadata: { category: 'engineering', priority: 1 }
      },
      {
        name: 'Eve Davis',
        email: 'eve@example.com',
        age: 32,
        score: 550.0,
        isActive: false,
        tags: ['user', 'intern'],
        // No metadata
      }
    ];

    collection.insertBulk(testData);
  });

  describe('Basic Comparison Operators', () => {
    test('eq - equals', () => {
      const results = collection.where('age').eq(30).toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Bob Johnson');
    });

    test('neq - not equals', () => {
      const results = collection.where('age').neq(30).toArray();
      expect(results).toHaveLength(4);
      expect(results.every(r => r.age !== 30)).toBe(true);
    });

    test('gt - greater than', () => {
      const results = collection.where('age').gt(30).toArray();
      expect(results).toHaveLength(2);
      expect(results.every(r => r.age > 30)).toBe(true);
    });

    test('gte - greater than or equal', () => {
      const results = collection.where('age').gte(30).toArray();
      expect(results).toHaveLength(3);
      expect(results.every(r => r.age >= 30)).toBe(true);
    });

    test('lt - less than', () => {
      const results = collection.where('age').lt(30).toArray();
      expect(results).toHaveLength(2);
      expect(results.every(r => r.age < 30)).toBe(true);
    });

    test('lte - less than or equal', () => {
      const results = collection.where('age').lte(30).toArray();
      expect(results).toHaveLength(3);
      expect(results.every(r => r.age <= 30)).toBe(true);
    });
  });

  describe('Range Operators', () => {
    test('between - range query', () => {
      const results = collection.where('age').between(28, 32).toArray();
      expect(results).toHaveLength(3);
      expect(results.every(r => r.age >= 28 && r.age <= 32)).toBe(true);
    });

    test('between with decimals', () => {
      const results = collection.where('score').between(700, 900).toArray();
      expect(results).toHaveLength(2);
      expect(results.every(r => r.score >= 700 && r.score <= 900)).toBe(true);
    });
  });

  describe('Array Operators', () => {
    test('in - value in array', () => {
      const results = collection.where('age').in([25, 35]).toArray();
      expect(results).toHaveLength(2);
      expect(results.every(r => [25, 35].includes(r.age))).toBe(true);
    });

    test('nin - value not in array', () => {
      const results = collection.where('age').nin([25, 35]).toArray();
      expect(results).toHaveLength(3);
      expect(results.every(r => ![25, 35].includes(r.age))).toBe(true);
    });

    test('in with single value', () => {
      const results = collection.where('age').in([30]).toArray();
      expect(results).toHaveLength(1);
      expect(results[0].age).toBe(30);
    });

    test('in with empty array returns no results', () => {
      const results = collection.where('age').in([]).toArray();
      expect(results).toHaveLength(0);
    });
  });

  describe('String Operators', () => {
    test('like - pattern matching', () => {
      const results = collection.where('name').like('Alice%').toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Smith');
    });

    test('ilike - case insensitive pattern matching', () => {
      const results = collection.where('name').ilike('alice%').toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Smith');
    });

    test('startsWith - prefix matching', () => {
      const results = collection.where('name').startsWith('Bob').toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Bob Johnson');
    });

    test('endsWith - suffix matching', () => {
      const results = collection.where('name').endsWith('Brown').toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Charlie Brown');
    });

    test('contains - substring matching', () => {
      const results = collection.where('email').contains('example').toArray();
      expect(results).toHaveLength(5);
    });

    test('contains - specific substring', () => {
      const results = collection.where('name').contains('Johnson').toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Bob Johnson');
    });
  });

  describe('Existence Operators', () => {
    test('exists - field has value', () => {
      const results = collection.where('metadata').exists().toArray();
      expect(results).toHaveLength(4);
      expect(results.every(r => r.metadata !== undefined)).toBe(true);
    });

    test('notExists - field is null/undefined', () => {
      const results = collection.where('metadata').notExists().toArray();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Eve Davis');
    });
  });

  describe('Complex Queries', () => {
    test('multiple conditions with and()', () => {
      const results = collection
        .where('age').gte(25)
        .and().where('age').lte(30)
        .and().where('isActive').eq(true)
        .toArray();
      
      expect(results).toHaveLength(3); // Alice (25), Diana (28), Bob (30) - all active
      expect(results.every(r => r.age >= 25 && r.age <= 30 && r.isActive)).toBe(true);
    });

    test('chained conditions without explicit and()', () => {
      const results = collection
        .where('score').gt(700)
        .where('isActive').eq(true)
        .toArray();
      
      expect(results).toHaveLength(3); // Alice (850.5), Diana (920.75), Bob (750.0) - all active and > 700
      expect(results.every(r => r.score > 700 && r.isActive)).toBe(true);
    });

    test('complex string and number conditions', () => {
      const results = collection
        .where('name').startsWith('A')
        .where('score').gte(800)
        .toArray();
      
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Smith');
    });
  });

  describe('Sorting', () => {
    test('orderBy single field ascending', () => {
      const results = collection.orderBy('age', 'asc').toArray();
      expect(results).toHaveLength(5);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].age).toBeGreaterThanOrEqual(results[i-1].age);
      }
    });

    test('orderBy single field descending', () => {
      const results = collection.orderBy('score', 'desc').toArray();
      expect(results).toHaveLength(5);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i-1].score);
      }
    });

    test('orderBy multiple fields', () => {
      const results = collection
        .orderBy('isActive', 'desc')
        .orderBy('age', 'asc')
        .toArray();
      
      expect(results).toHaveLength(5);
      // First should be active users sorted by age
      const activeUsers = results.filter(r => r.isActive);
      const inactiveUsers = results.filter(r => !r.isActive);
      
      expect(activeUsers.length).toBe(3);
      expect(inactiveUsers.length).toBe(2);
      
      // Check active users come first and are sorted by age
      for (let i = 1; i < activeUsers.length; i++) {
        expect(activeUsers[i].age).toBeGreaterThanOrEqual(activeUsers[i-1].age);
      }
    });

    test('orderByOnly - replace existing order', () => {
      const builder = collection.orderBy('age', 'asc');
      const results = builder.orderByOnly('score', 'desc').toArray();
      
      expect(results).toHaveLength(5);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i-1].score);
      }
    });

    test('orderByMultiple - set multiple fields at once', () => {
      const results = collection.orderByMultiple([
        { field: 'isActive', direction: 'desc' },
        { field: 'score', direction: 'desc' }
      ]).toArray();
      
      expect(results).toHaveLength(5);
      expect(results[0].isActive).toBe(true);
      expect(results[0].score).toBe(920.75); // Diana - highest score among active
    });
  });

  describe('Pagination', () => {
    test('limit only', () => {
      const results = collection.orderBy('age').limit(3).toArray();
      expect(results).toHaveLength(3);
    });

    test('offset only', () => {
      const results = collection.orderBy('age').offset(2).toArray();
      expect(results).toHaveLength(3);
    });

    test('limit and offset', () => {
      const results = collection.orderBy('age').limit(2).offset(1).toArray();
      expect(results).toHaveLength(2);
    });

    test('page helper method', () => {
      // Page 1, size 2
      const page1 = collection.orderBy('age').page(1, 2).toArray();
      expect(page1).toHaveLength(2);
      
      // Page 2, size 2
      const page2 = collection.orderBy('age').page(2, 2).toArray();
      expect(page2).toHaveLength(2);
      
      // Page 3, size 2
      const page3 = collection.orderBy('age').page(3, 2).toArray();
      expect(page3).toHaveLength(1);
      
      // Ensure no overlap
      const allIds = [...page1, ...page2, ...page3].map(r => r.id);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    test('page validation', () => {
      expect(() => collection.page(0, 10)).toThrow('Page number must be >= 1');
      expect(() => collection.page(1, 0)).toThrow('Page size must be >= 1');
      expect(() => collection.page(-1, 10)).toThrow('Page number must be >= 1');
    });

    test('limit validation', () => {
      expect(() => collection.limit(-1)).toThrow('Limit must be non-negative');
    });

    test('offset validation', () => {
      expect(() => collection.offset(-1)).toThrow('Offset must be non-negative');
    });
  });

  describe('Advanced Features', () => {
    test('distinct results', () => {
      // Add duplicate ages
      collection.insert({
        name: 'Another 25 year old',
        email: 'another25@example.com',
        age: 25,
        score: 600,
        isActive: true,
        tags: ['user']
      });
      
      const results = collection.distinct().toArray();
      // All records should still be returned since docs are different
      expect(results.length).toBeGreaterThan(5);
    });

    test('count with filters', () => {
      const count = collection.where('isActive').eq(true).count();
      expect(count).toBe(3);
    });

    test('first with filters', () => {
      const result = collection
        .where('score').gt(800)
        .orderBy('score', 'desc')
        .first();
      
      expect(result?.name).toBe('Diana Wilson');
      expect(result?.score).toBe(920.75);
    });

    test('first returns null when no results', () => {
      const result = collection.where('age').gt(100).first();
      expect(result).toBeNull();
    });
  });

  describe('Query Builder State Management', () => {
    test('clearFilters', () => {
      const builder = collection.where('age').gt(30);
      expect(builder.hasFilters()).toBe(true);
      expect(builder.getFilterCount()).toBe(1);
      
      builder.clearFilters();
      expect(builder.hasFilters()).toBe(false);
      expect(builder.getFilterCount()).toBe(0);
    });

    test('clearOrder', () => {
      const builder = collection.where('age').gt(0).orderBy('age');
      expect(builder.hasOrdering()).toBe(true);
      
      builder.clearOrder();
      expect(builder.hasOrdering()).toBe(false);
    });

    test('clearLimit', () => {
      const builder = collection.where('age').gt(0).limit(10).offset(5);
      expect(builder.hasPagination()).toBe(true);
      
      builder.clearLimit();
      expect(builder.hasPagination()).toBe(false);
    });

    test('reset - clear all state', () => {
      const builder = collection
        .where('age').gt(20)
        .orderBy('name')
        .limit(10);
      
      expect(builder.hasFilters()).toBe(true);
      expect(builder.hasOrdering()).toBe(true);
      expect(builder.hasPagination()).toBe(true);
      
      builder.reset();
      expect(builder.hasFilters()).toBe(false);
      expect(builder.hasOrdering()).toBe(false);
      expect(builder.hasPagination()).toBe(false);
    });

    test('clone query builder', () => {
      const original = collection
        .where('age').gte(25)
        .orderBy('score', 'desc')
        .limit(3);
      
      const cloned = original.clone();
      
      // Both should return same results
      const originalResults = original.toArray();
      const clonedResults = cloned.toArray();
      
      expect(originalResults).toHaveLength(clonedResults.length);
      expect(originalResults[0].id).toBe(clonedResults[0].id);
      
      // Modifying clone shouldn't affect original
      cloned.where('isActive').eq(true);
      const newClonedResults = cloned.toArray();
      const newOriginalResults = original.toArray();
      
      expect(newClonedResults.length).toBeLessThanOrEqual(newOriginalResults.length);
    });

    test('query inspection methods', () => {
      const builder = collection
        .where('age').gt(20)
        .where('isActive').eq(true)
        .orderBy('score')
        .limit(10)
        .offset(5);
      
      expect(builder.hasFilters()).toBe(true);
      expect(builder.getFilterCount()).toBe(2);
      expect(builder.hasOrdering()).toBe(true);
      expect(builder.hasPagination()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('FieldBuilder execution methods throw errors', () => {
      const fieldBuilder = collection.where('age');
      
      expect(() => fieldBuilder.toArray()).toThrow('should not be called on FieldBuilder');
      expect(() => fieldBuilder.first()).toThrow('should not be called on FieldBuilder');
      expect(() => fieldBuilder.count()).toThrow('should not be called on FieldBuilder');
    });
  });

  describe('Performance and Edge Cases', () => {
    test('large limit values', () => {
      const results = collection.limit(1000).toArray();
      expect(results).toHaveLength(5); // Only 5 records exist
    });

    test('large offset values', () => {
      const results = collection.offset(1000).toArray();
      expect(results).toHaveLength(0);
    });

    test('empty string searches', () => {
      const results = collection.where('name').contains('').toArray();
      expect(results).toHaveLength(5); // All records contain empty string
    });

    test('null value comparisons', () => {
      const results = collection.where('metadata').exists().toArray();
      expect(results).toHaveLength(4);
    });

    test('boolean field queries', () => {
      const activeCount = collection.where('isActive').eq(true).count();
      const inactiveCount = collection.where('isActive').eq(false).count();
      
      expect(activeCount).toBe(3);
      expect(inactiveCount).toBe(2);
      expect(activeCount + inactiveCount).toBe(5);
    });
  });
});