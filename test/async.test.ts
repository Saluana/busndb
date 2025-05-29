import { test, expect } from 'bun:test';
import { z } from 'zod';
import { createDB } from '../src/index';

// Test schema
const testSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    value: z.number(),
    data: z.object({
        nested: z.string().optional()
    }).optional()
});

test('Async Mode - Basic CRUD Operations', async () => {
    const db = createDB({ memory: true });
    const collection = db.collection('async_test', testSchema);

    // Test async insert
    const doc = await collection.insertAsync({
        name: 'Test User',
        value: 42,
        data: { nested: 'test' }
    });
    expect(doc.name).toBe('Test User');
    expect(doc.value).toBe(42);
    expect(typeof doc.id).toBe('string');

    // Test async find
    const found = await collection.findByIdAsync(doc.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Test User');

    // Test async update
    const updated = await collection.putAsync(doc.id, {
        name: 'Updated User',
        value: 100
    });
    expect(updated.name).toBe('Updated User');
    expect(updated.value).toBe(100);

    // Test async upsert
    const newId = crypto.randomUUID();
    const upserted = await collection.upsertAsync(newId, {
        name: 'Upserted User',
        value: 200
    });
    expect(upserted.name).toBe('Upserted User');
    expect(upserted.id).toBe(newId);

    // Test async query operations
    const all = await collection.toArrayAsync();
    expect(all.length).toBe(2);

    const count = await collection.countAsync();
    expect(count).toBe(2);

    const first = await collection.firstAsync();
    expect(first).not.toBeNull();

    // Test async query builder
    const filtered = await collection.where('value').gte(100).toArrayAsync();
    expect(filtered.length).toBe(2);

    const filterCount = await collection.where('name').like('%User%').countAsync();
    expect(filterCount).toBe(2);

    const firstFiltered = await collection.where('value').eq(200).firstAsync();
    expect(firstFiltered!.name).toBe('Upserted User');

    // Test async delete
    const deleted = await collection.deleteAsync(doc.id);
    expect(deleted).toBe(true);

    const finalCount = await collection.countAsync();
    expect(finalCount).toBe(1);

    await db.closeAsync();
});

test('Async Mode - Bulk Operations', async () => {
    const db = createDB({ memory: true });
    const collection = db.collection('async_bulk_test', testSchema);

    // Test async bulk insert
    const docs = await collection.insertBulkAsync([
        { name: 'User 1', value: 10 },
        { name: 'User 2', value: 20 },
        { name: 'User 3', value: 30 }
    ]);
    expect(docs.length).toBe(3);
    expect(docs[0].name).toBe('User 1');

    // Test async bulk update
    const updated = await collection.putBulkAsync([
        { id: docs[0].id, doc: { name: 'Updated User 1' } },
        { id: docs[1].id, doc: { name: 'Updated User 2' } }
    ]);
    expect(updated.length).toBe(2);
    expect(updated[0].name).toBe('Updated User 1');

    // Test async bulk upsert
    const upserted = await collection.upsertBulkAsync([
        { id: docs[2].id, doc: { name: 'Upserted User 3', value: 300 } },
        { id: crypto.randomUUID(), doc: { name: 'New User 4', value: 40 } }
    ]);
    expect(upserted.length).toBe(2);
    expect(upserted[0].name).toBe('Upserted User 3');
    expect(upserted[0].value).toBe(300);

    // Test async bulk delete
    const deletedCount = await collection.deleteBulkAsync([docs[0].id, docs[1].id]);
    expect(deletedCount).toBe(2);

    const finalCount = await collection.countAsync();
    expect(finalCount).toBe(2);

    await db.closeAsync();
});

test('Async Mode - Transactions', async () => {
    const db = createDB({ memory: true });
    const collection = db.collection('async_transaction_test', testSchema);

    // Test transaction with async operations
    await db.transaction(async () => {
        const doc1 = await collection.insertAsync({
            name: 'Transaction User 1',
            value: 100
        });

        const doc2 = await collection.insertAsync({
            name: 'Transaction User 2', 
            value: 200
        });

        await collection.putAsync(doc1.id, {
            name: 'Updated in Transaction',
            value: 150
        });

        // Verify changes within transaction
        const updated = await collection.findByIdAsync(doc1.id);
        expect(updated!.name).toBe('Updated in Transaction');
    });

    // Verify changes persisted after transaction
    const count = await collection.countAsync();
    expect(count).toBe(2);

    const all = await collection.toArrayAsync();
    const updatedUser = all.find(u => u.name === 'Updated in Transaction');
    expect(updatedUser).not.toBeUndefined();
    expect(updatedUser!.value).toBe(150);

    await db.closeAsync();
});

test('Async Mode - Database Operations', async () => {
    const db = createDB({ memory: true });
    const collection = db.collection('async_db_test', testSchema);

    // Insert some test data
    await collection.insertAsync({ name: 'Test', value: 1 });
    await collection.insertAsync({ name: 'Test 2', value: 2 });

    // Test raw async query
    const result = await db.queryAsync('SELECT COUNT(*) as count FROM async_db_test');
    expect(result[0].count).toBe(2);

    // Test raw async exec - use JSON update since value is in document
    await db.execAsync('UPDATE async_db_test SET doc = json_set(doc, "$.value", json_extract(doc, "$.value") * 10)');
    
    const updated = await collection.toArrayAsync();
    expect(updated.find(u => u.name === 'Test')?.value).toBe(10);
    expect(updated.find(u => u.name === 'Test 2')?.value).toBe(20);

    await db.closeAsync();
});

test('Async Mode - Error Handling', async () => {
    const db = createDB({ memory: true });
    const collection = db.collection('async_error_test', testSchema);

    // Test async operation with validation error
    try {
        await collection.insertAsync({
            name: 'Test',
            value: 'invalid' as any // Should cause validation error
        });
        expect(true).toBe(false); // Should not reach here
    } catch (error) {
        expect(error.message).toContain('validation failed');
    }

    // Test async find on non-existent document
    const notFound = await collection.findByIdAsync('non-existent-id');
    expect(notFound).toBeNull();

    // Test async update on non-existent document
    try {
        await collection.putAsync('non-existent-id', { name: 'Test' });
        expect(true).toBe(false); // Should not reach here
    } catch (error) {
        expect(error.message).toContain('not found');
    }

    await db.closeAsync();
});

test('Async Mode - Compatibility with Sync Operations', async () => {
    const db = createDB({ memory: true });
    const collection = db.collection('async_compat_test', testSchema);

    // Mix sync and async operations
    const syncDoc = collection.insert({ name: 'Sync User', value: 1 });
    const asyncDoc = await collection.insertAsync({ name: 'Async User', value: 2 });

    // Sync operations should see async results
    const syncAll = collection.toArray();
    expect(syncAll.length).toBe(2);

    // Async operations should see sync results
    const asyncAll = await collection.toArrayAsync();
    expect(asyncAll.length).toBe(2);

    // Mix sync and async queries
    const syncCount = collection.where('name').like('%User%').count();
    const asyncCount = await collection.countAsync();
    expect(syncCount).toBe(asyncCount);
    expect(syncCount).toBe(2);

    await db.closeAsync();
});