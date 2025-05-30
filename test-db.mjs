#!/usr/bin/env node

console.log('Starting test...');

import { createDB } from './dist/src/index.js';
import { z } from 'zod';

console.log('Imports successful, testing database initialization...');

try {
    const db = createDB({ path: ':memory:', driver: 'node' });
    console.log('✅ Database created successfully');

    const schema = z.object({
        id: z.string().optional(),
        title: z.string(),
        completed: z.boolean().default(false),
    });

    const collection = db.collection('test', schema);
    console.log('✅ Collection created successfully');

    await collection.insert({ title: 'Test todo', completed: false });
    console.log('✅ Insert successful');

    const todos = await collection.toArray();
    console.log('✅ Query successful:', todos);

    console.log('Database test completed successfully!');
} catch (error) {
    console.error('❌ Database test failed:', error);
}
