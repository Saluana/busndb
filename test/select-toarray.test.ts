import { describe, test, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { createDB } from '../src/index.js';
import type { Database } from '../src/database.js';

const userSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
});

describe('select() with toArray()', () => {
    let db: Database;
    let users: ReturnType<typeof db.collection<typeof userSchema>>;

    beforeEach(() => {
        db = createDB({ memory: true });
        users = db.collection('users', userSchema);
        users.insertBulkSync([
            { id: crypto.randomUUID(), name: 'Alice', email: 'alice@example.com' },
            { id: crypto.randomUUID(), name: 'Bob', email: 'bob@example.com' },
        ]);
    });

    test('returns only selected fields and excludes id', () => {
        const results = users.query().select('name', 'email').toArraySync();
        expect(results).toHaveLength(2);
        for (const r of results) {
            expect(r).toHaveProperty('name');
            expect(r).toHaveProperty('email');
            expect(r).not.toHaveProperty('id');
        }
    });
});
