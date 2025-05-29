import { z } from 'zod';
import { createDB } from './src/index';

// Example demonstrating async mode usage
async function main() {
    console.log('🚀 BusNDB Async Mode Example\n');

    // Define schema  
    const userSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().int().min(18),
        departmentId: z.string(),
        profile: z.object({
            bio: z.string().optional(),
            skills: z.array(z.string()).optional(),
            settings: z.record(z.any()).optional()
        }).optional(),
        createdAt: z.date().default(() => new Date()),
    });

    // Create database
    const db = createDB({ memory: true });

    // Create collection with constrained fields
    const users = db.collection('users', userSchema, {
        constrainedFields: {
            email: { unique: true, nullable: false },
            age: { type: 'INTEGER' },
            departmentId: { type: 'TEXT' }
        }
    });

    console.log('📊 Testing Async CRUD Operations...\n');

    // Async Insert
    console.log('1. Async Insert:');
    const user1 = await users.insertAsync({
        name: 'Alice Johnson',
        email: 'alice@example.com',
        age: 28,
        departmentId: 'dept-123',
        profile: {
            bio: 'Software Engineer',
            skills: ['TypeScript', 'React'],
            settings: { theme: 'dark' }
        }
    });
    console.log('   Created user:', user1.name, '(ID:', user1.id.slice(0, 8) + '...)');

    // Async Bulk Insert
    console.log('\n2. Async Bulk Insert:');
    const bulkUsers = await users.insertBulkAsync([
        {
            name: 'Bob Smith',
            email: 'bob@example.com',
            age: 32,
            departmentId: 'dept-456',
            profile: { bio: 'Product Manager', skills: ['Strategy', 'Analytics'] }
        },
        {
            name: 'Carol Davis',
            email: 'carol@example.com',
            age: 25,
            departmentId: 'dept-123',
            profile: { bio: 'Designer', skills: ['Figma', 'CSS'] }
        }
    ]);
    console.log('   Created', bulkUsers.length, 'users in bulk');

    // Async Find
    console.log('\n3. Async Find by ID:');
    const foundUser = await users.findByIdAsync(user1.id);
    console.log('   Found user:', foundUser?.name);

    // Async Query
    console.log('\n4. Async Query with Conditions:');
    const engineeringUsers = await users
        .where('departmentId').eq('dept-123')
        .where('age').gte(25)
        .toArrayAsync();
    console.log('   Found', engineeringUsers.length, 'users in engineering dept with age >= 25');

    // Async Update
    console.log('\n5. Async Update:');
    const updatedUser = await users.putAsync(user1.id, {
        profile: {
            ...user1.profile,
            bio: 'Senior Software Engineer',
            skills: ['TypeScript', 'React', 'Node.js']
        }
    });
    console.log('   Updated user bio to:', updatedUser.profile.bio);

    // Async Upsert
    console.log('\n6. Async Upsert:');
    const newUserId = crypto.randomUUID();
    const upsertedUser = await users.upsertAsync(newUserId, {
        name: 'David Wilson',
        email: 'david@example.com',
        age: 30,
        departmentId: 'dept-789',
        profile: { bio: 'DevOps Engineer' }
    });
    console.log('   Upserted user:', upsertedUser.name);

    // Async Count
    console.log('\n7. Async Count:');
    const totalUsers = await users.countAsync();
    const youngUsers = await users.where('age').lt(30).countAsync();
    console.log('   Total users:', totalUsers);
    console.log('   Users under 30:', youngUsers);

    // Async First
    console.log('\n8. Async First:');
    const oldestUser = await users.orderBy('age', 'desc').firstAsync();
    console.log('   Oldest user:', oldestUser?.name, 'age:', oldestUser?.age);

    // Async Transaction
    console.log('\n9. Async Transaction:');
    await db.transaction(async () => {
        const newUser = await users.insertAsync({
            name: 'Transaction User',
            email: 'transaction@example.com',
            age: 27,
            departmentId: 'dept-999'
        });
        
        await users.putAsync(newUser.id, {
            profile: { bio: 'Updated in same transaction' }
        });
        
        console.log('   Created and updated user in transaction:', newUser.name);
    });

    // Async Bulk Operations
    console.log('\n10. Async Bulk Operations:');
    const allUsers = await users.toArrayAsync();
    const userIds = allUsers.slice(0, 2).map(u => u.id);
    
    await users.putBulkAsync([
        { id: userIds[0], doc: { age: 29 } },
        { id: userIds[1], doc: { age: 35 } }
    ]);
    console.log('   Updated ages for 2 users in bulk');

    // Final count
    console.log('\n📊 Final Statistics:');
    const finalCount = await users.countAsync();
    const avgAge = await users.toArrayAsync().then(users => 
        users.reduce((sum, u) => sum + u.age, 0) / users.length
    );
    console.log('   Total users:', finalCount);
    console.log('   Average age:', Math.round(avgAge));

    // Async database operations
    console.log('\n🔧 Async Database Operations:');
    const rawResult = await db.queryAsync('SELECT COUNT(*) as count FROM users');
    console.log('   Raw query result:', rawResult[0].count, 'users');

    // Clean up
    await db.closeAsync();
    console.log('\n✅ Database closed asynchronously');
    console.log('\n🎉 Async mode example completed successfully!');
    console.log('\n📝 Key Benefits:');
    console.log('   • Non-blocking operations for better performance');
    console.log('   • Proper async/await patterns');
    console.log('   • Plugin hooks are properly awaited');
    console.log('   • Full backward compatibility with sync methods');
}

// Comparison function showing both sync and async approaches
async function performanceComparison() {
    console.log('\n⚡ Performance Comparison: Sync vs Async\n');

    const db = createDB({ memory: true });
    const testSchema = z.object({
        id: z.string().uuid(),
        value: z.number(),
        data: z.string()
    });
    const collection = db.collection('test', testSchema);

    const testData = Array.from({ length: 1000 }, (_, i) => ({
        value: i,
        data: `test-data-${i}`
    }));

    // Sync version
    console.log('Testing sync operations...');
    const syncStart = Date.now();
    for (const item of testData.slice(0, 100)) {
        collection.insert(item);
    }
    const syncTime = Date.now() - syncStart;
    console.log(`Sync: Inserted 100 items in ${syncTime}ms`);

    // Async version  
    console.log('Testing async operations...');
    const asyncStart = Date.now();
    for (const item of testData.slice(100, 200)) {
        await collection.insertAsync(item);
    }
    const asyncTime = Date.now() - asyncStart;
    console.log(`Async: Inserted 100 items in ${asyncTime}ms`);

    // Bulk async (optimal)
    console.log('Testing bulk async operations...');
    const bulkStart = Date.now();
    await collection.insertBulkAsync(testData.slice(200, 300));
    const bulkTime = Date.now() - bulkStart;
    console.log(`Bulk Async: Inserted 100 items in ${bulkTime}ms`);

    await db.closeAsync();
    
    console.log('\n📊 Results:');
    console.log(`   Sync operations:       ${syncTime}ms`);
    console.log(`   Async operations:      ${asyncTime}ms`);
    console.log(`   Bulk async operations: ${bulkTime}ms`);
    console.log('\n💡 Use async for better concurrency, bulk operations for best performance!');
}

// Run the examples
main()
    .then(() => performanceComparison())
    .catch(console.error);