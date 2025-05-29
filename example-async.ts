import { z } from 'zod';
import { createDB } from './src/index';

// Example demonstrating async mode usage
async function main() {
    console.log('🚀 BusNDB - Async by Default Example\n');

    // Define schema
    const userSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().int().min(18),
        departmentId: z.string(),
        profile: z
            .object({
                bio: z.string().optional(),
                skills: z.array(z.string()).optional(),
                settings: z.record(z.any()).optional(),
            })
            .optional(),
        createdAt: z.date().default(() => new Date()),
    });

    // Create database
    const db = createDB({ memory: true });

    // Create collection with constrained fields
    const users = db.collection('users', userSchema, {
        constrainedFields: {
            email: { unique: true, nullable: false },
            age: { type: 'INTEGER' },
            departmentId: { type: 'TEXT' },
        },
    });

    console.log('📊 Testing Default Operations (Async by Default)...\n');

    // Default Insert (Async)
    console.log('1. Default Insert (Async):');
    const user1 = await users.insert({
        name: 'Alice Johnson',
        email: 'alice@example.com',
        age: 28,
        departmentId: 'dept-123',
        profile: {
            bio: 'Software Engineer',
            skills: ['TypeScript', 'React'],
            settings: { theme: 'dark' },
        },
    });
    console.log(
        '   Created user:',
        user1.name,
        '(ID:',
        user1.id.slice(0, 8) + '...)'
    );

    // Default Bulk Insert (Async)
    console.log('\n2. Default Bulk Insert (Async):');
    const bulkUsers = await users.insertBulk([
        {
            name: 'Bob Smith',
            email: 'bob@example.com',
            age: 32,
            departmentId: 'dept-456',
            profile: {
                bio: 'Product Manager',
                skills: ['Strategy', 'Analytics'],
            },
        },
        {
            name: 'Carol Davis',
            email: 'carol@example.com',
            age: 25,
            departmentId: 'dept-123',
            profile: { bio: 'Designer', skills: ['Figma', 'CSS'] },
        },
    ]);
    console.log('   Created', bulkUsers.length, 'users in bulk');

    // Default Find (Async)
    console.log('\n3. Default Find by ID (Async):');
    const foundUser = await users.findById(user1.id);
    console.log('   Found user:', foundUser?.name);

    // Default Query (Async)
    console.log('\n4. Default Query with Conditions (Async):');
    const engineeringUsers = await users
        .where('departmentId')
        .eq('dept-123')
        .where('age')
        .gte(25)
        .toArray();
    console.log(
        '   Found',
        engineeringUsers.length,
        'users in engineering dept with age >= 25'
    );

    // Default Update (Async)
    console.log('\n5. Default Update (Async):');
    const updatedUser = await users.put(user1.id, {
        profile: {
            ...user1.profile,
            bio: 'Senior Software Engineer',
            skills: ['TypeScript', 'React', 'Node.js'],
        },
    });
    console.log('   Updated user bio to:', updatedUser?.profile?.bio);

    // Default Upsert (Async)
    console.log('\n6. Default Upsert (Async):');
    const newUserId = crypto.randomUUID();
    const upsertedUser = await users.upsert(newUserId, {
        name: 'David Wilson',
        email: 'david@example.com',
        age: 30,
        departmentId: 'dept-789',
        profile: { bio: 'DevOps Engineer' },
    });
    console.log('   Upserted user:', upsertedUser.name);

    // Default Count (Async)
    console.log('\n7. Default Count (Async):');
    const totalUsers = await users.count();
    const youngUsers = await users.where('age').lt(30).count();
    console.log('   Total users:', totalUsers);
    console.log('   Users under 30:', youngUsers);

    // Default First (Async)
    console.log('\n8. Default First (Async):');
    const oldestUser = await users.orderBy('age', 'desc').first();
    console.log('   Oldest user:', oldestUser?.name, 'age:', oldestUser?.age);

    // Default Transaction (Async)
    console.log('\n9. Default Transaction (Async):');
    await db.transaction(async () => {
        const newUser = await users.insert({
            name: 'Transaction User',
            email: 'transaction@example.com',
            age: 27,
            departmentId: 'dept-999',
        });

        await users.put(newUser.id, {
            profile: { bio: 'Updated in same transaction' },
        });

        console.log(
            '   Created and updated user in transaction:',
            newUser.name
        );
    });

    // Default Bulk Operations (Async)
    console.log('\n10. Default Bulk Operations (Async):');
    const allUsers = await users.toArray();
    const userIds = allUsers.slice(0, 2).map((u) => u.id);

    await users.putBulk([
        { id: userIds[0], doc: { age: 29 } },
        { id: userIds[1], doc: { age: 35 } },
    ]);
    console.log('   Updated ages for 2 users in bulk');

    // Final count
    console.log('\n📊 Final Statistics:');
    const finalCount = await users.count();
    const avgAge = await users
        .toArray()
        .then(
            (users) => users.reduce((sum, u) => sum + u.age, 0) / users.length
        );
    console.log('   Total users:', finalCount);
    console.log('   Average age:', Math.round(avgAge));

    // Default database operations (Async)
    console.log('\n🔧 Default Database Operations (Async):');
    const rawResult = await db.query('SELECT COUNT(*) as count FROM users');
    console.log('   Raw query result:', rawResult[0].count, 'users');

    // Clean up
    await db.close();
    console.log('\n✅ Database closed (async by default)');
    console.log('\n🎉 Async mode example completed successfully!');
    console.log('\n📝 Key Benefits:');
    console.log('   • Async by default for non-blocking operations');
    console.log('   • Modern async/await patterns');
    console.log('   • Plugin hooks are properly awaited');
    console.log(
        '   • Sync versions available with "Sync" suffix for compatibility'
    );
}

// Comparison function showing sync vs async (default) approaches
async function performanceComparison() {
    console.log('\n⚡ Performance Comparison: Sync vs Async (Default)\n');

    const db = createDB({ memory: true });
    const testSchema = z.object({
        id: z.string().uuid(),
        value: z.number(),
        data: z.string(),
    });
    const collection = db.collection('test', testSchema);

    const testData = Array.from({ length: 1000 }, (_, i) => ({
        value: i,
        data: `test-data-${i}`,
    }));

    // Sync version (with Sync suffix)
    console.log('Testing sync operations (with Sync suffix)...');
    const syncStart = Date.now();
    for (const item of testData.slice(0, 100)) {
        collection.insertSync(item);
    }
    const syncTime = Date.now() - syncStart;
    console.log(`Sync: Inserted 100 items in ${syncTime}ms`);

    // Default async version
    console.log('Testing default operations (async by default)...');
    const asyncStart = Date.now();
    for (const item of testData.slice(100, 200)) {
        await collection.insert(item);
    }
    const asyncTime = Date.now() - asyncStart;
    console.log(`Default (Async): Inserted 100 items in ${asyncTime}ms`);

    // Bulk async (optimal)
    console.log('Testing bulk operations (async by default)...');
    const bulkStart = Date.now();
    await collection.insertBulk(testData.slice(200, 300));
    const bulkTime = Date.now() - bulkStart;
    console.log(`Bulk (Async): Inserted 100 items in ${bulkTime}ms`);

    await db.close();

    console.log('\n📊 Results:');
    console.log(`   Sync operations (Sync suffix): ${syncTime}ms`);
    console.log(`   Default operations (Async):    ${asyncTime}ms`);
    console.log(`   Bulk operations (Async):       ${bulkTime}ms`);
    console.log(
        '\n💡 Default async enables concurrency, bulk operations for best performance!'
    );
}

// Run the examples
main()
    .then(() => performanceComparison())
    .catch(console.error);
