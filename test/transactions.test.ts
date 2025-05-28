import { describe, test, expect, beforeEach } from 'bun:test';
import { z } from 'zod';
import { createDB } from '../src/index';
import { ValidationError, DatabaseError } from '../src/errors';

describe('Transactions', () => {
    let db: ReturnType<typeof createDB>;
    const userSchema = z.object({
        id: z
            .string()
            .uuid()
            .default(() => crypto.randomUUID()),
        name: z.string().min(1),
        email: z.string().email(),
        age: z.number().int().optional(),
        createdAt: z.date().default(() => new Date()),
    });
    const postSchema = z.object({
        id: z
            .string()
            .uuid()
            .default(() => crypto.randomUUID()),
        title: z.string(),
        content: z.string(),
        authorId: z.string().uuid(),
    });

    beforeEach(() => {
        db = createDB({ memory: true });
    });

    test('commits all changes on success', async () => {
        const users = db.collection('users', userSchema);
        const posts = db.collection('posts', postSchema);
        const result = await db.transaction(async () => {
            const user = users.insert({
                name: 'John',
                email: 'john@example.com',
            });
            const post = posts.insert({
                title: 'Hello',
                content: 'World',
                authorId: user.id!,
            });
            return { user, post };
        });
        expect(result.user.name).toBe('John');
        expect(users.toArray()).toHaveLength(1);
        expect(posts.toArray()).toHaveLength(1);
    });

    test('rolls back all changes on error', async () => {
        const users = db.collection('users', userSchema);
        let error;
        try {
            await db.transaction(async () => {
                users.insert({ name: 'A', email: 'a@example.com' });
                throw new Error('fail');
            });
        } catch (e) {
            error = e;
        }
        expect(error).toBeTruthy();
        expect(users.toArray()).toHaveLength(0);
    });

    test('rolls back on validation error', async () => {
        const users = db.collection('users', userSchema);
        let error;
        try {
            await db.transaction(async () => {
                users.insert({ name: '', email: 'bad' } as any);
            });
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ValidationError);
        expect(users.toArray()).toHaveLength(0);
    });

    test('returns value from transaction', async () => {
        const users = db.collection('users', userSchema);
        const id = await db.transaction(async () => {
            const user = users.insert({
                name: 'Jane',
                email: 'jane@example.com',
            });
            return user.id;
        });
        expect(typeof id).toBe('string');
        expect(users.findById(id!)).toBeTruthy();
    });

    test('nested transactions reuse context and rollback all', async () => {
        const users = db.collection('users', userSchema);
        let error;
        try {
            await db.transaction(async () => {
                users.insert({ name: 'Outer', email: 'outer@example.com' });
                await db.transaction(async () => {
                    users.insert({ name: 'Inner', email: 'inner@example.com' });
                });
                throw new Error('fail outer');
            });
        } catch (e) {
            error = e;
        }
        expect(error).toBeTruthy();
        expect(users.toArray()).toHaveLength(0);
    });

    test('bulk operations are atomic', async () => {
        const users = db.collection('users', userSchema);
        await db.transaction(async () => {
            users.insertBulk([
                { name: 'A', email: 'a@example.com' },
                { name: 'B', email: 'b@example.com' },
            ]);
        });
        expect(users.toArray()).toHaveLength(2);
    });

    test('bulk operations rollback on error', async () => {
        const users = db.collection('users', userSchema);
        let error;
        try {
            await db.transaction(async () => {
                users.insertBulk([
                    { name: 'A', email: 'a@example.com' },
                    { name: '', email: 'bad' } as any,
                ]);
            });
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ValidationError);
        expect(users.toArray()).toHaveLength(0);
    });

    test('supports reads and writes in transaction', async () => {
        const users = db.collection('users', userSchema);
        users.insert({ name: 'X', email: 'x@example.com' });
        const result = await db.transaction(async () => {
            const before = users.toArray().length;
            users.insert({ name: 'Y', email: 'y@example.com' });
            const after = users.toArray().length;
            return { before, after };
        });
        expect(result.before).toBe(1);
        expect(result.after).toBe(2);
        expect(users.toArray()).toHaveLength(2);
    });

    test('transaction isolation: changes not visible until commit', async () => {
        const users = db.collection('users', userSchema);
        let txDone = false;
        const tx = db.transaction(async () => {
            users.insert({ name: 'Z', email: 'z@example.com' });
            await new Promise((r) => setTimeout(r, 20));
            txDone = true;
            return users.toArray().length;
        });
        expect(users.toArray()).toHaveLength(0);
        const count = await tx;
        expect(txDone).toBe(true);
        expect(count).toBe(1);
        expect(users.toArray()).toHaveLength(1);
    });
});
