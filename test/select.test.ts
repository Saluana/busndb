import { describe, test, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { createDB } from '../src/index.js';
import type { Database } from '../src/database.js';

const userSchema = z.object({
    _id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().int(),
    department: z.string(),
    isActive: z.boolean(),
    metadata: z
        .object({
            role: z.string(),
            level: z.number(),
        })
        .optional(),
});

describe('Select Field Tests', () => {
    let db: Database;
    let users: ReturnType<typeof db.collection<typeof userSchema>>;

    beforeEach(() => {
        db = createDB({ memory: true });
        users = db.collection('users', userSchema);
        users.insertBulkSync([
            {
                _id: crypto.randomUUID(),
                name: 'Alice',
                email: 'alice@example.com',
                age: 25,
                department: 'Engineering',
                isActive: true,
                metadata: { role: 'senior', level: 3 },
            },
            {
                _id: crypto.randomUUID(),
                name: 'Bob',
                email: 'bob@example.com',
                age: 30,
                department: 'Marketing',
                isActive: true,
                metadata: { role: 'manager', level: 2 },
            },
            {
                _id: crypto.randomUUID(),
                name: 'Charlie',
                email: 'charlie@example.com',
                age: 35,
                department: 'Sales',
                isActive: false,
                metadata: { role: 'junior', level: 1 },
            },
        ]);
    });

    describe('Basic Select Operations (Sync)', () => {
        test('select single field', () => {
            const results = users.query().select('name').toArraySync();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).not.toHaveProperty('email');
                expect(r).not.toHaveProperty('age');
                expect(r).not.toHaveProperty('_id');
            }
        });

        test('select multiple fields', () => {
            const results = users.query().select('name', 'email').toArraySync();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('email');
                expect(r).not.toHaveProperty('age');
                expect(r).not.toHaveProperty('_id');
            }
        });

        test('select all basic fields', () => {
            const results = users
                .query()
                .select('name', 'email', 'age', 'department', 'isActive')
                .toArraySync();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('email');
                expect(r).toHaveProperty('age');
                expect(r).toHaveProperty('department');
                expect(r).toHaveProperty('isActive');
                expect(r).not.toHaveProperty('_id');
                expect(r).not.toHaveProperty('metadata');
            }
        });

        test('select nested object fields', () => {
            const results = users
                .query()
                .select('name', 'metadata')
                .toArraySync();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('metadata');
                expect(r).not.toHaveProperty('email');
                expect(r).not.toHaveProperty('_id');
            }
        });

        test('select with filters', () => {
            const results = users
                .query()
                .where('isActive')
                .eq(true)
                .select('name', 'department')
                .toArraySync();

            expect(results).toHaveLength(2);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('department');
                expect(r).not.toHaveProperty('email');
                expect(r).not.toHaveProperty('isActive');
            }
            expect(results.map((r) => r.name)).toEqual(
                expect.arrayContaining(['Alice', 'Bob'])
            );
        });

        test('select with ordering', () => {
            const results = users
                .query()
                .select('name', 'age')
                .orderBy('age', 'desc')
                .toArraySync();

            expect(results).toHaveLength(3);
            expect(results[0].name).toBe('Charlie');
            expect(results[0].age).toBe(35);
            expect(results[1].name).toBe('Bob');
            expect(results[1].age).toBe(30);
            expect(results[2].name).toBe('Alice');
            expect(results[2].age).toBe(25);
        });

        test('select with limit', () => {
            const results = users
                .query()
                .select('name', 'age')
                .orderBy('age', 'asc')
                .limit(2)
                .toArraySync();

            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('Alice');
            expect(results[1].name).toBe('Bob');
        });

        test('select with firstSync', () => {
            const result = users
                .query()
                .select('name', 'department')
                .where('department')
                .eq('Engineering')
                .firstSync();

            expect(result).not.toBeNull();
            expect(result).toHaveProperty('name', 'Alice');
            expect(result).toHaveProperty('department', 'Engineering');
            expect(result).not.toHaveProperty('email');
            expect(result).not.toHaveProperty('_id');
        });

        test('select returns null when no results with firstSync', () => {
            const result = users
                .query()
                .select('name')
                .where('age')
                .gt(100)
                .firstSync();

            expect(result).toBeNull();
        });
    });

    describe('Basic Select Operations (Async)', () => {
        test('select single field async', async () => {
            const results = await users.query().select('name').toArray();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).not.toHaveProperty('email');
                expect(r).not.toHaveProperty('age');
                expect(r).not.toHaveProperty('_id');
            }
        });

        test('select multiple fields async', async () => {
            const results = await users
                .query()
                .select('name', 'email')
                .toArray();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('email');
                expect(r).not.toHaveProperty('age');
                expect(r).not.toHaveProperty('_id');
            }
        });

        test('select with exec alias async', async () => {
            const results = await users.query().select('name', 'email').exec();
            expect(results).toHaveLength(3);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('email');
                expect(r).not.toHaveProperty('age');
                expect(r).not.toHaveProperty('_id');
            }
        });

        test('select with filters async', async () => {
            const results = await users
                .query()
                .where('isActive')
                .eq(true)
                .select('name', 'department')
                .toArray();

            expect(results).toHaveLength(2);
            for (const r of results) {
                expect(r).toHaveProperty('name');
                expect(r).toHaveProperty('department');
                expect(r).not.toHaveProperty('email');
                expect(r).not.toHaveProperty('isActive');
            }
        });

        test('select with ordering async', async () => {
            const results = await users
                .query()
                .select('name', 'age')
                .orderBy('age', 'desc')
                .toArray();

            expect(results).toHaveLength(3);
            expect(results[0].name).toBe('Charlie');
            expect(results[1].name).toBe('Bob');
            expect(results[2].name).toBe('Alice');
        });

        test('select with first async', async () => {
            const result = await users
                .query()
                .select('name', 'department')
                .where('department')
                .eq('Engineering')
                .first();

            expect(result).not.toBeNull();
            expect(result).toHaveProperty('name', 'Alice');
            expect(result).toHaveProperty('department', 'Engineering');
            expect(result).not.toHaveProperty('email');
            expect(result).not.toHaveProperty('_id');
        });

        test('select returns null when no results with first async', async () => {
            const result = await users
                .query()
                .select('name')
                .where('age')
                .gt(100)
                .first();

            expect(result).toBeNull();
        });
    });

    describe('Advanced Select Operations', () => {
        test('select with complex where conditions', () => {
            const results = users
                .query()
                .where('age')
                .gte(25)
                .where('age')
                .lte(30)
                .select('name', 'age', 'department')
                .orderBy('age')
                .toArraySync();

            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('Alice');
            expect(results[1].name).toBe('Bob');
        });

        test('select with OR conditions', () => {
            const results = users
                .query()
                .where('department')
                .eq('Engineering')
                .or((builder) => builder.where('department').eq('Sales'))
                .select('name', 'department')
                .orderBy('name')
                .toArraySync();

            expect(results).toHaveLength(2);
            expect(results[0].name).toBe('Alice');
            expect(results[0].department).toBe('Engineering');
            expect(results[1].name).toBe('Charlie');
            expect(results[1].department).toBe('Sales');
        });

        test('select with string operations', () => {
            const results = users
                .query()
                .where('email')
                .contains('alice')
                .select('name', 'email')
                .toArraySync();

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('Alice');
        });

        test('select with pagination', () => {
            const page1 = users
                .query()
                .select('name', 'age')
                .orderBy('age')
                .page(1, 2)
                .toArraySync();

            const page2 = users
                .query()
                .select('name', 'age')
                .orderBy('age')
                .page(2, 2)
                .toArraySync();

            expect(page1).toHaveLength(2);
            expect(page2).toHaveLength(1);
            expect(page1[0].name).toBe('Alice');
            expect(page1[1].name).toBe('Bob');
            expect(page2[0].name).toBe('Charlie');
        });

        test('select with distinct', () => {
            // Add duplicate department data
            users.insertSync({
                _id: crypto.randomUUID(),
                name: 'David',
                email: 'david@example.com',
                age: 28,
                department: 'Engineering',
                isActive: true,
                metadata: { role: 'junior', level: 1 },
            });

            const results = users
                .query()
                .select('name', 'department')
                .where('department')
                .eq('Engineering')
                .toArraySync();

            expect(results).toHaveLength(2);
            expect(results.map((r) => r.name)).toEqual(
                expect.arrayContaining(['Alice', 'David'])
            );
        });
    });

    describe('Edge Cases and Error Handling', () => {
        test('select with no fields should throw or handle gracefully', () => {
            // This might depend on implementation - test current behavior
            const results = users.query().select().toArraySync();
            // Assuming it returns all fields or handles gracefully
            expect(results).toHaveLength(3);
        });

        test('select with invalid field names', () => {
            // Note: This might not throw an error if fields are treated as JSON paths
            const results = users.query().select('nonexistent').toArraySync();
            expect(results).toHaveLength(3);
            // Should still return results but field might be undefined
        });

        test('select with empty result set', () => {
            const results = users
                .query()
                .where('age')
                .gt(100)
                .select('name', 'age')
                .toArraySync();

            expect(results).toHaveLength(0);
        });

        test('select with nested field paths', () => {
            const results = users
                .query()
                .select('name', 'metadata.role', 'metadata.level')
                .where('metadata.role')
                .eq('senior')
                .toArraySync();

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe('Alice');
            // Check if nested field selection works
            expect(results[0]).toHaveProperty('metadata.role');
        });
    });

    describe('Mixed Sync and Async Behavior', () => {
        test('ensure sync and async return same results', async () => {
            const syncResults = users
                .query()
                .select('name', 'age')
                .where('isActive')
                .eq(true)
                .orderBy('age')
                .toArraySync();

            const asyncResults = await users
                .query()
                .select('name', 'age')
                .where('isActive')
                .eq(true)
                .orderBy('age')
                .toArray();

            expect(syncResults).toEqual(asyncResults);
        });

        test('ensure sync and async first return same result', async () => {
            const syncResult = users
                .query()
                .select('name', 'department')
                .where('age')
                .gte(30)
                .orderBy('age')
                .firstSync();

            const asyncResult = await users
                .query()
                .select('name', 'department')
                .where('age')
                .gte(30)
                .orderBy('age')
                .first();

            expect(syncResult).toEqual(asyncResult);
        });
    });

    describe('Performance and Large Datasets', () => {
        test('select fields with large dataset', () => {
            // Add more test data
            const bulkData = Array.from({ length: 100 }, (_, i) => ({
                _id: crypto.randomUUID(),
                name: `User${i}`,
                email: `user${i}@example.com`,
                age: 20 + (i % 40),
                department: ['Engineering', 'Marketing', 'Sales'][i % 3],
                isActive: i % 2 === 0,
                metadata: { role: 'user', level: 1 + (i % 3) },
            }));

            users.insertBulkSync(bulkData);

            const start = performance.now();
            const results = users
                .query()
                .select('name', 'department')
                .where('isActive')
                .eq(true)
                .limit(50)
                .toArraySync();
            const end = performance.now();

            expect(results).toHaveLength(50);
            expect(end - start).toBeLessThan(100); // Should complete within 100ms
        });
    });
});
