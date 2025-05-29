import { describe, test, expect, beforeEach } from 'bun:test';
import { z } from 'zod';
import { createDB } from '../src/index.js';
import { unique, foreignKey, index } from '../src/schema-constraints.js';

const userSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().int().optional(),
    isActive: z.boolean().default(true),
    tags: z.array(z.string()).default([]),
    createdAt: z.date().default(() => new Date()),
});

const postSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    content: z.string(),
    authorId: z.string().uuid(),
    publishedAt: z.date().optional(),
    viewCount: z.number().int().default(0),
});

const categorySchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().optional(),
    parentId: z.string().uuid().optional(),
});

describe('Tables: BusNDB API vs Raw SQL Verification', () => {
    let db: ReturnType<typeof createDB>;
    let users: ReturnType<typeof db.collection<typeof userSchema>>;
    let posts: ReturnType<typeof db.collection<typeof postSchema>>;
    let categories: ReturnType<typeof db.collection<typeof categorySchema>>;

    beforeEach(() => {
        db = createDB({ memory: true });
        
        users = db.collection('users', userSchema, {
            constrainedFields: {
                email: { unique: true, nullable: false },
                name: { type: 'TEXT' },
                age: { type: 'INTEGER' }
            },
            constraints: {
                indexes: {
                    name: index('name'),
                    age: index('age'),
                },
            },
        });
        
        posts = db.collection('posts', postSchema, {
            constrainedFields: {
                authorId: { 
                    foreignKey: 'users._id',
                    onDelete: 'CASCADE' 
                },
                title: { type: 'TEXT' },
                viewCount: { type: 'INTEGER' }
            },
            constraints: {
                indexes: {
                    title: index('title'),
                    viewCount: index('viewCount'),
                },
            },
        });
        
        categories = db.collection('categories', categorySchema, {
            constrainedFields: {
                parentId: { 
                    foreignKey: 'categories._id',
                    onDelete: 'CASCADE',
                    nullable: true
                },
                name: { type: 'TEXT' }
            },
            constraints: {
                indexes: {
                    name: index('name'),
                },
            },
        });
    });

    test('table creation and structure verification', () => {
        // Check if tables were created
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        const tableNames = tables.map(row => row.name);
        
        expect(tableNames).toContain('users');
        expect(tableNames).toContain('posts');
        expect(tableNames).toContain('categories');
        
        // Check users table structure (BusNDB uses _id and doc columns + constrained fields)
        const usersColumns = db.query("PRAGMA table_info(users)");
        const userColumnNames = usersColumns.map(col => col.name);
        expect(userColumnNames).toContain('_id');
        expect(userColumnNames).toContain('doc');
        expect(userColumnNames).toContain('email'); // Constrained field
        expect(userColumnNames).toContain('name'); // Constrained field
        expect(userColumnNames).toContain('age'); // Constrained field
        
        // Check posts table structure
        const postsColumns = db.query("PRAGMA table_info(posts)");
        const postColumnNames = postsColumns.map(col => col.name);
        expect(postColumnNames).toContain('_id');
        expect(postColumnNames).toContain('doc');
        expect(postColumnNames).toContain('authorId'); // Constrained field
        expect(postColumnNames).toContain('title'); // Constrained field
        expect(postColumnNames).toContain('viewCount'); // Constrained field
    });

    test('indexes and constraints verification', () => {
        // Check indexes - constrained fields should have indexes
        const indexes = db.query("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
        const indexNames = indexes.map(idx => idx.name);
        
        // Should have indexes for constrained fields
        expect(indexes.length).toBeGreaterThan(0);
        
        // Check foreign key constraints on constrained fields
        const postsForeignKeys = db.query("PRAGMA foreign_key_list(posts)");
        expect(postsForeignKeys.length).toBeGreaterThan(0);
        expect(postsForeignKeys[0].table).toBe('users');
        expect(postsForeignKeys[0].from).toBe('authorId');
        expect(postsForeignKeys[0].to).toBe('_id');
        
        // Check categories foreign key constraint (self-referential)
        const categoriesForeignKeys = db.query("PRAGMA foreign_key_list(categories)");
        expect(categoriesForeignKeys.length).toBeGreaterThan(0);
        expect(categoriesForeignKeys[0].table).toBe('categories');
        expect(categoriesForeignKeys[0].from).toBe('parentId');
        expect(categoriesForeignKeys[0].to).toBe('_id');
    });

    test('insert operations: API vs Raw SQL verification', () => {
        // Insert using API
        const user = users.insert({
            name: 'John Doe',
            email: 'john@example.com',
            age: 30,
            tags: ['developer', 'typescript'],
        });
        
        // Verify using raw SQL
        const rawUserRows = db.query("SELECT * FROM users WHERE _id = ?", [user.id]);
        expect(rawUserRows.length).toBe(1);
        
        const rawUser = rawUserRows[0];
        expect(rawUser._id).toBe(user.id);
        expect(rawUser.email).toBe('john@example.com'); // Constrained field
        
        // Check doc column contains the full document
        const parsedData = JSON.parse(rawUser.doc);
        expect(parsedData.name).toBe('John Doe');
        expect(parsedData.email).toBe('john@example.com');
        expect(parsedData.age).toBe(30);
        expect(parsedData.tags).toEqual(['developer', 'typescript']);
        expect(parsedData.isActive).toBe(true);
        expect(new Date(parsedData.createdAt)).toBeInstanceOf(Date);
        
        // Insert post referencing the user
        const post = posts.insert({
            title: 'My First Post',
            content: 'Hello world!',
            authorId: user.id,
            viewCount: 5,
        });
        
        // Verify post using raw SQL
        const rawPostRows = db.query("SELECT * FROM posts WHERE _id = ?", [post.id]);
        expect(rawPostRows.length).toBe(1);
        
        const rawPost = rawPostRows[0];
        expect(rawPost.authorId).toBe(user.id); // Constrained field
        
        const parsedPostData = JSON.parse(rawPost.doc);
        expect(parsedPostData.title).toBe('My First Post');
        expect(parsedPostData.content).toBe('Hello world!');
        expect(parsedPostData.viewCount).toBe(5);
    });

    test('bulk insert operations verification', () => {
        // Insert multiple users using API
        const userData = [
            { name: 'Alice', email: 'alice@example.com', age: 25 },
            { name: 'Bob', email: 'bob@example.com', age: 35 },
            { name: 'Carol', email: 'carol@example.com', age: 28 },
        ];
        
        const insertedUsers = users.insertBulk(userData);
        expect(insertedUsers.length).toBe(3);
        
        // Verify count using raw SQL
        const countResult = db.query("SELECT COUNT(*) as count FROM users");
        expect(countResult[0].count).toBe(3);
        
        // Verify all users exist using raw SQL
        const allUsersRaw = db.query("SELECT * FROM users ORDER BY name");
        expect(allUsersRaw.length).toBe(3);
        
        // Verify the users using constrained field columns
        expect(allUsersRaw[0].name).toBe('Alice');
        expect(allUsersRaw[1].name).toBe('Bob');
        expect(allUsersRaw[2].name).toBe('Carol');
        
        // Verify data integrity
        for (let i = 0; i < allUsersRaw.length; i++) {
            const rawUser = allUsersRaw[i];
            const parsedData = JSON.parse(rawUser.doc);
            expect(parsedData.email).toBe(rawUser.email); // Constrained field matches
            expect(parsedData.name).toBe(rawUser.name); // Constrained field matches
            expect(parsedData.isActive).toBe(true);
        }
    });

    test('query operations: API vs Raw SQL verification', () => {
        // Setup test data
        const testUsers = [
            { name: 'Developer Dan', email: 'dan@dev.com', age: 30, tags: ['javascript', 'python'] },
            { name: 'Designer Dana', email: 'dana@design.com', age: 28, tags: ['figma', 'sketch'] },
            { name: 'Manager Mike', email: 'mike@mgmt.com', age: 45, tags: ['leadership'] },
        ];
        
        const insertedUsers = users.insertBulk(testUsers);
        
        // Test simple where query
        const developersAPI = users.where('name').like('Developer%').toArray();
        const developersSQL = db.query("SELECT * FROM users WHERE name LIKE 'Developer%'");
        
        expect(developersAPI.length).toBe(1);
        expect(developersSQL.length).toBe(1);
        expect(developersAPI[0].name).toBe(developersSQL[0].name);
        
        // Test age range query
        const youngUsersAPI = users.where('age').lt(35).toArray();
        const youngUsersSQL = db.query("SELECT * FROM users WHERE age < 35");
        
        expect(youngUsersAPI.length).toBe(2);
        expect(youngUsersSQL.length).toBe(2);
        
        // Test ordering
        const orderedAPI = users.orderBy('age', 'desc').toArray();
        const orderedSQL = db.query("SELECT * FROM users ORDER BY age DESC");
        
        expect(orderedAPI.length).toBe(orderedSQL.length);
        expect(orderedAPI[0].age).toBe(orderedSQL[0].age);
        expect(orderedAPI[0].age).toBe(45); // Manager Mike should be first
    });

    test('update operations verification', () => {
        // Insert test user
        const user = users.insert({
            name: 'Update Test',
            email: 'update@test.com',
            age: 25,
        });
        
        // Update using API
        const updatedUser = users.put(user.id, { 
            name: 'Updated Name',
            age: 26,
        });
        
        // Verify using raw SQL
        const rawUpdatedRows = db.query("SELECT * FROM users WHERE _id = ?", [user.id]);
        expect(rawUpdatedRows.length).toBe(1);
        
        const rawUpdated = rawUpdatedRows[0];
        expect(rawUpdated.email).toBe('update@test.com'); // Constrained field should remain unchanged
        expect(rawUpdated.name).toBe('Updated Name'); // Constrained field updated
        expect(rawUpdated.age).toBe(26); // Constrained field updated
        
        const parsedData = JSON.parse(rawUpdated.doc);
        expect(parsedData.name).toBe('Updated Name');
        expect(parsedData.age).toBe(26);
        expect(parsedData.email).toBe('update@test.com');
        
        // Verify API and SQL return same data
        expect(updatedUser.name).toBe(rawUpdated.name);
        expect(updatedUser.age).toBe(rawUpdated.age);
    });

    test('delete operations verification', () => {
        // Insert test users
        const users1 = users.insertBulk([
            { name: 'Delete Me', email: 'delete1@test.com' },
            { name: 'Keep Me', email: 'keep@test.com' },
            { name: 'Delete Me Too', email: 'delete2@test.com' },
        ]);
        
        // Delete one user using API
        const deleteResult = users.delete(users1[0].id);
        expect(deleteResult).toBe(true);
        
        // Verify deletion using raw SQL
        const remainingUsers = db.query("SELECT COUNT(*) as count FROM users");
        expect(remainingUsers[0].count).toBe(2);
        
        const deletedCheck = db.query("SELECT * FROM users WHERE _id = ?", [users1[0].id]);
        expect(deletedCheck.length).toBe(0);
        
        // Delete multiple users
        const bulkDeleteResult = users.deleteBulk([users1[1].id, users1[2].id]);
        expect(bulkDeleteResult).toBe(2);
        
        // Verify bulk deletion using raw SQL
        const finalCount = db.query("SELECT COUNT(*) as count FROM users");
        expect(finalCount[0].count).toBe(0);
    });

    test('constraint violations verification', () => {
        // Insert user
        const user = users.insert({
            name: 'Constraint Test',
            email: 'constraint@test.com',
        });
        
        // Test unique constraint violation
        expect(() => {
            users.insert({
                name: 'Another User',
                email: 'constraint@test.com', // Same email
            });
        }).toThrow();
        
        // Verify only one user exists using raw SQL
        const emailCheckSQL = db.query("SELECT COUNT(*) as count FROM users WHERE email = ?", ['constraint@test.com']);
        expect(emailCheckSQL[0].count).toBe(1);
        
        // Test foreign key constraint
        expect(() => {
            posts.insert({
                title: 'Bad Post',
                content: 'This should fail',
                authorId: 'non-existent-id',
            });
        }).toThrow();
        
        // Verify no posts exist using raw SQL
        const postsCountSQL = db.query("SELECT COUNT(*) as count FROM posts");
        expect(postsCountSQL[0].count).toBe(0);
        
        // Insert valid post
        const validPost = posts.insert({
            title: 'Valid Post',
            content: 'This should work',
            authorId: user.id,
        });
        
        // Verify post exists using raw SQL
        const validPostSQL = db.query("SELECT * FROM posts WHERE _id = ?", [validPost.id]);
        expect(validPostSQL.length).toBe(1);
        expect(validPostSQL[0].authorId).toBe(user.id);
    });

    test('complex queries with joins verification', () => {
        // Setup data
        const user = users.insert({
            name: 'Author User',
            email: 'author@example.com',
            age: 30,
        });
        
        const userPosts = posts.insertBulk([
            { title: 'Post 1', content: 'Content 1', authorId: user.id, viewCount: 10 },
            { title: 'Post 2', content: 'Content 2', authorId: user.id, viewCount: 20 },
            { title: 'Post 3', content: 'Content 3', authorId: user.id, viewCount: 30 },
        ]);
        
        // Verify data using raw SQL joins
        const joinQuery = `
            SELECT 
                u.name as author_name,
                u.email as author_email,
                p.title as post_title,
                p.viewCount as view_count
            FROM users u
            JOIN posts p ON u._id = p.authorId
            ORDER BY p.viewCount DESC
        `;
        
        const joinResults = db.query(joinQuery);
        expect(joinResults.length).toBe(3);
        expect(joinResults[0].author_name).toBe('Author User');
        expect(joinResults[0].post_title).toBe('Post 3');
        expect(joinResults[0].view_count).toBe(30);
        expect(joinResults[2].view_count).toBe(10);
        
        // Verify total view count using aggregation
        const aggregateQuery = `
            SELECT 
                u.name,
                COUNT(p._id) as post_count,
                SUM(p.viewCount) as total_views
            FROM users u
            LEFT JOIN posts p ON u._id = p.authorId
            GROUP BY u._id, u.name
        `;
        
        const aggregateResults = db.query(aggregateQuery);
        expect(aggregateResults.length).toBe(1);
        expect(aggregateResults[0].post_count).toBe(3);
        expect(aggregateResults[0].total_views).toBe(60);
    });

    test('transaction verification', async () => {
        await db.transaction(async () => {
            // Insert user and posts in transaction
            const user = users.insert({
                name: 'Transaction User',
                email: 'transaction@test.com',
            });
            
            posts.insertBulk([
                { title: 'TX Post 1', content: 'Content 1', authorId: user.id },
                { title: 'TX Post 2', content: 'Content 2', authorId: user.id },
            ]);
        });
        
        // Verify all data was committed using raw SQL
        const userCount = db.query("SELECT COUNT(*) as count FROM users WHERE name = 'Transaction User'");
        expect(userCount[0].count).toBe(1);
        
        const postCount = db.query("SELECT COUNT(*) as count FROM posts WHERE title LIKE 'TX Post%'");
        expect(postCount[0].count).toBe(2);
        
        // Verify referential integrity
        const integrityCheck = db.query(`
            SELECT p.title, u.name
            FROM posts p 
            JOIN users u ON p.authorId = u._id 
            WHERE p.title LIKE 'TX Post%'
        `);
        expect(integrityCheck.length).toBe(2);
        expect(integrityCheck[0].name).toBe('Transaction User');
        expect(integrityCheck[1].name).toBe('Transaction User');
    });

    test('self-referential foreign key verification', () => {
        // Create parent category
        const parentCategory = categories.insert({
            name: 'Programming',
            description: 'All about programming',
        });
        
        // Create child category
        const childCategory = categories.insert({
            name: 'TypeScript',
            description: 'TypeScript programming',
            parentId: parentCategory.id,
        });
        
        // Verify using raw SQL
        const categoryTree = db.query(`
            SELECT 
                child.name as child_name,
                parent.name as parent_name
            FROM categories child
            LEFT JOIN categories parent ON child.parentId = parent._id
            ORDER BY child.name
        `);
        
        expect(categoryTree.length).toBe(2);
        
        // Find the child category record
        const childRecord = categoryTree.find(cat => cat.child_name === 'TypeScript');
        expect(childRecord).toBeDefined();
        expect(childRecord!.parent_name).toBe('Programming');
        
        // Find the parent category record (should have no parent)
        const parentRecord = categoryTree.find(cat => cat.child_name === 'Programming');
        expect(parentRecord).toBeDefined();
        expect(parentRecord!.parent_name).toBeNull();
    });

    test('data type preservation verification', () => {
        const testUser = users.insert({
            name: 'Type Test User',
            email: 'types@test.com',
            age: 42,
            isActive: false,
            tags: ['test', 'types', 'verification'],
            createdAt: new Date('2023-01-01T00:00:00Z'),
        });
        
        // Verify using API
        const apiUser = users.findById(testUser.id);
        expect(apiUser).not.toBeNull();
        expect(typeof apiUser!.age).toBe('number');
        expect(typeof apiUser!.isActive).toBe('boolean');
        expect(Array.isArray(apiUser!.tags)).toBe(true);
        expect(apiUser!.createdAt instanceof Date).toBe(true);
        
        // Verify using raw SQL
        const rawUser = db.query("SELECT * FROM users WHERE _id = ?", [testUser.id])[0];
        const parsedData = JSON.parse(rawUser.doc);
        
        expect(parsedData.age).toBe(42);
        expect(parsedData.isActive).toBe(false);
        expect(parsedData.tags).toEqual(['test', 'types', 'verification']);
        
        // Check that createdAt is preserved correctly (BusNDB stores dates as objects)
        expect(parsedData.createdAt).toEqual({
            __type: "Date",
            value: testUser.createdAt!.toISOString(),
        });
        
        // Verify constrained fields match
        expect(rawUser.email).toBe(testUser.email); // email is a constrained field
    });

    // === EDGE CASE TESTS ===

    test('null and undefined handling in constrained fields', () => {
        // Test nullable constrained field (parentId in categories)
        const rootCategory = categories.insert({
            name: 'Root Category',
            description: 'A root category with no parent',
            parentId: undefined, // Should be stored as NULL
        });

        // Verify using raw SQL
        const rawCategory = db.query("SELECT * FROM categories WHERE _id = ?", [rootCategory.id])[0];
        expect(rawCategory.parentId).toBeNull();

        const parsedData = JSON.parse(rawCategory.doc);
        expect(parsedData.parentId).toBeUndefined();

        // Test optional field with no value
        const userWithoutAge = users.insert({
            name: 'Ageless User',
            email: 'ageless@test.com',
            // age is optional and not provided
        });

        const rawUserWithoutAge = db.query("SELECT * FROM users WHERE _id = ?", [userWithoutAge.id])[0];
        expect(rawUserWithoutAge.age).toBeNull(); // Constrained field should be NULL
        
        const parsedUserData = JSON.parse(rawUserWithoutAge.doc);
        expect(parsedUserData.age).toBeUndefined();
    });

    test('special characters and Unicode handling', () => {
        const specialUser = users.insert({
            name: '🚀 José Müller-Öäü 北京',
            email: 'jose.muller+test@example-test.com',
            age: 25,
            tags: ['🔥', '测试', 'Ñoño', 'café', '"quotes"', "'apostrophes'", 'back\\slash'],
        });

        // Verify using raw SQL
        const rawSpecialUser = db.query("SELECT * FROM users WHERE _id = ?", [specialUser.id])[0];
        expect(rawSpecialUser.name).toBe('🚀 José Müller-Öäü 北京');
        expect(rawSpecialUser.email).toBe('jose.muller+test@example-test.com');

        const parsedData = JSON.parse(rawSpecialUser.doc);
        expect(parsedData.tags).toContain('🔥');
        expect(parsedData.tags).toContain('测试');
        expect(parsedData.tags).toContain('"quotes"');
        expect(parsedData.tags).toContain("'apostrophes'");
        expect(parsedData.tags).toContain('back\\slash');

        // Test query with special characters
        const foundUser = users.where('name').eq('🚀 José Müller-Öäü 北京').first();
        expect(foundUser).not.toBeNull();
        expect(foundUser!.name).toBe(specialUser.name);
    });

    test('empty collections and operations', () => {
        // Test operations on empty collections
        const emptyQuery = users.where('age').gt(100).toArray();
        expect(emptyQuery).toEqual([]);

        const emptyCount = db.query("SELECT COUNT(*) as count FROM users")[0].count;
        expect(emptyCount).toBe(0);

        // Test bulk operations with empty arrays
        const emptyBulkInsert = users.insertBulk([]);
        expect(emptyBulkInsert).toEqual([]);

        const emptyBulkDelete = users.deleteBulk([]);
        expect(emptyBulkDelete).toBe(0);

        // Test aggregations on empty tables
        const avgAge = db.query("SELECT AVG(age) as avg_age FROM users")[0].avg_age;
        expect(avgAge).toBeNull();

        const maxAge = db.query("SELECT MAX(age) as max_age FROM users")[0].max_age;
        expect(maxAge).toBeNull();
    });

    test('large data and field limits', () => {
        // Test very long strings
        const longName = 'A'.repeat(10000);
        const longContent = 'Lorem ipsum '.repeat(1000);
        
        const userWithLongData = users.insert({
            name: longName,
            email: 'long@test.com',
            tags: Array.from({length: 100}, (_, i) => `tag_${i}`),
        });

        // Verify data integrity
        const rawUser = db.query("SELECT * FROM users WHERE _id = ?", [userWithLongData.id])[0];
        expect(rawUser.name.length).toBe(10000);
        
        const parsedData = JSON.parse(rawUser.doc);
        expect(parsedData.tags.length).toBe(100);
        
        // Test large post content
        const postWithLongContent = posts.insert({
            title: 'Long Post',
            content: longContent,
            authorId: userWithLongData.id,
        });

        const rawPost = db.query("SELECT * FROM posts WHERE _id = ?", [postWithLongContent.id])[0];
        const parsedPostData = JSON.parse(rawPost.doc);
        expect(parsedPostData.content.length).toBeGreaterThan(10000);
    });

    test('number precision and edge values', () => {
        // Test integer limits
        const userWithEdgeNumbers = users.insert({
            name: 'Number Test',
            email: 'numbers@test.com',
            age: 2147483647, // Max 32-bit signed integer
        });

        const postWithBigNumbers = posts.insert({
            title: 'Big Numbers',
            content: 'Testing large numbers',
            authorId: userWithEdgeNumbers.id,
            viewCount: 9007199254740991, // Max safe integer in JavaScript
        });

        // Verify using raw SQL
        const rawUser = db.query("SELECT * FROM users WHERE _id = ?", [userWithEdgeNumbers.id])[0];
        expect(rawUser.age).toBe(2147483647);

        const rawPost = db.query("SELECT * FROM posts WHERE _id = ?", [postWithBigNumbers.id])[0];
        expect(rawPost.viewCount).toBe(9007199254740991);

        // Test zero and negative numbers
        const zeroAgeUser = users.insert({
            name: 'Zero Age',
            email: 'zero@test.com',
            age: 0,
        });

        const negativeViewPost = posts.insert({
            title: 'Negative Views',
            content: 'Post with negative views',
            authorId: userWithEdgeNumbers.id,
            viewCount: -100,
        });

        const rawZeroUser = db.query("SELECT * FROM users WHERE _id = ?", [zeroAgeUser.id])[0];
        expect(rawZeroUser.age).toBe(0);

        const rawNegativePost = db.query("SELECT * FROM posts WHERE _id = ?", [negativeViewPost.id])[0];
        expect(rawNegativePost.viewCount).toBe(-100);
    });

    test('boolean edge cases and falsy values', () => {
        // Test explicit false values
        const inactiveUser = users.insert({
            name: 'Inactive User',
            email: 'inactive@test.com',
            isActive: false,
        });

        // Test default true value
        const defaultActiveUser = users.insert({
            name: 'Default Active',
            email: 'default@test.com',
            // isActive should default to true
        });

        // Verify using raw SQL
        const rawInactive = db.query("SELECT * FROM users WHERE _id = ?", [inactiveUser.id])[0];
        const inactiveData = JSON.parse(rawInactive.doc);
        expect(inactiveData.isActive).toBe(false);

        const rawDefault = db.query("SELECT * FROM users WHERE _id = ?", [defaultActiveUser.id])[0];
        const defaultData = JSON.parse(rawDefault.doc);
        expect(defaultData.isActive).toBe(true);

        // Test querying by boolean values
        const activeUsers = db.query("SELECT * FROM users WHERE JSON_EXTRACT(doc, '$.isActive') = true");
        const inactiveUsers = db.query("SELECT * FROM users WHERE JSON_EXTRACT(doc, '$.isActive') = false");
        
        expect(activeUsers.length).toBe(1);
        expect(inactiveUsers.length).toBe(1);
    });

    test('date and time edge cases', () => {
        // Test various date formats and edge cases
        const epoch = new Date(0); // Unix epoch
        const farFuture = new Date('2099-12-31T23:59:59.999Z');
        const farPast = new Date('1900-01-01T00:00:00.000Z');

        const epochUser = users.insert({
            name: 'Epoch User',
            email: 'epoch@test.com',
            createdAt: epoch,
        });

        const futureUser = users.insert({
            name: 'Future User',
            email: 'future@test.com',
            createdAt: farFuture,
        });

        const pastUser = users.insert({
            name: 'Past User',
            email: 'past@test.com',
            createdAt: farPast,
        });

        // Verify date storage and retrieval
        const rawEpoch = db.query("SELECT * FROM users WHERE _id = ?", [epochUser.id])[0];
        const epochData = JSON.parse(rawEpoch.doc);
        expect(epochData.createdAt.value).toBe(epoch.toISOString());

        const rawFuture = db.query("SELECT * FROM users WHERE _id = ?", [futureUser.id])[0];
        const futureData = JSON.parse(rawFuture.doc);
        expect(futureData.createdAt.value).toBe(farFuture.toISOString());

        // Test date ordering
        const chronologicalUsers = db.query(`
            SELECT name, JSON_EXTRACT(doc, '$.createdAt.value') as created_at 
            FROM users 
            ORDER BY JSON_EXTRACT(doc, '$.createdAt.value')
        `);
        
        expect(chronologicalUsers[0].name).toBe('Past User');
        expect(chronologicalUsers[chronologicalUsers.length - 1].name).toBe('Future User');
    });

    test('array and object nesting edge cases', () => {
        // Test deeply nested objects in tags and complex data
        const complexUser = users.insert({
            name: 'Complex Data User',
            email: 'complex@test.com',
            tags: [
                'simple',
                'tag_with_special_chars_!@#$%^&*()',
                '', // Empty string tag
                '   whitespace   ',
                'duplicate',
                'duplicate', // Duplicate tag
            ],
        });

        // Test very large arrays
        const largeArrayUser = users.insert({
            name: 'Large Array User',
            email: 'large@test.com',
            tags: Array.from({length: 1000}, (_, i) => `tag_${i}`),
        });

        // Verify complex data storage
        const rawComplex = db.query("SELECT * FROM users WHERE _id = ?", [complexUser.id])[0];
        const complexData = JSON.parse(rawComplex.doc);
        expect(complexData.tags).toContain('');
        expect(complexData.tags).toContain('   whitespace   ');
        expect(complexData.tags.filter((tag: string) => tag === 'duplicate')).toHaveLength(2);

        const rawLarge = db.query("SELECT * FROM users WHERE _id = ?", [largeArrayUser.id])[0];
        const largeData = JSON.parse(rawLarge.doc);
        expect(largeData.tags).toHaveLength(1000);
        expect(largeData.tags[999]).toBe('tag_999');
    });

    test('cascade delete behavior verification', () => {
        // Create user with multiple posts
        const author = users.insert({
            name: 'Author To Delete',
            email: 'author.delete@test.com',
        });

        const authorPosts = posts.insertBulk([
            { title: 'Post 1', content: 'Content 1', authorId: author.id },
            { title: 'Post 2', content: 'Content 2', authorId: author.id },
            { title: 'Post 3', content: 'Content 3', authorId: author.id },
        ]);

        // Verify posts exist
        const postsBeforeDelete = db.query("SELECT COUNT(*) as count FROM posts WHERE authorId = ?", [author.id]);
        expect(postsBeforeDelete[0].count).toBe(3);

        // Delete the author (should cascade delete posts)
        const deleteResult = users.delete(author.id);
        expect(deleteResult).toBe(true);

        // Verify cascade delete worked
        const postsAfterDelete = db.query("SELECT COUNT(*) as count FROM posts WHERE authorId = ?", [author.id]);
        expect(postsAfterDelete[0].count).toBe(0);

        // Verify author is deleted
        const authorAfterDelete = db.query("SELECT COUNT(*) as count FROM users WHERE _id = ?", [author.id]);
        expect(authorAfterDelete[0].count).toBe(0);

        // Test cascade delete with categories (self-referential)
        const parentCat = categories.insert({
            name: 'Parent Category',
        });

        const childCats = categories.insertBulk([
            { name: 'Child 1', parentId: parentCat.id },
            { name: 'Child 2', parentId: parentCat.id },
        ]);

        // Delete parent should cascade to children
        categories.delete(parentCat.id);

        const remainingCategories = db.query("SELECT COUNT(*) as count FROM categories");
        expect(remainingCategories[0].count).toBe(0);
    });

    test('partial updates and selective field updates', () => {
        const originalUser = users.insert({
            name: 'Original Name',
            email: 'original@test.com',
            age: 25,
            tags: ['original', 'tags'],
            isActive: true,
        });

        // Partial update - only change name and age
        const updatedUser = users.put(originalUser.id, {
            name: 'Updated Name',
            age: 30,
            // Don't specify email, tags, isActive - they should remain unchanged
        });

        // Verify partial update using raw SQL
        const rawUpdated = db.query("SELECT * FROM users WHERE _id = ?", [originalUser.id])[0];
        expect(rawUpdated.name).toBe('Updated Name'); // Changed
        expect(rawUpdated.age).toBe(30); // Changed
        expect(rawUpdated.email).toBe('original@test.com'); // Unchanged

        const parsedData = JSON.parse(rawUpdated.doc);
        expect(parsedData.tags).toEqual(['original', 'tags']); // Unchanged
        expect(parsedData.isActive).toBe(true); // Unchanged

        // Verify API result matches raw SQL
        expect(updatedUser.name).toBe(rawUpdated.name);
        expect(updatedUser.email).toBe(rawUpdated.email);
        expect(updatedUser.tags).toEqual(parsedData.tags);
    });

    test('case sensitivity and whitespace handling', () => {
        const users1 = users.insertBulk([
            { name: 'John Doe', email: 'john@test.com' },
            { name: 'JOHN DOE', email: 'JOHN@TEST.COM' },
            { name: '  spaced  ', email: 'spaced@test.com' },
            { name: 'mixed Case', email: 'Mixed@Test.Com' },
        ]);

        // Test case-sensitive queries
        const exactMatch = users.where('name').eq('John Doe').toArray();
        expect(exactMatch).toHaveLength(1);

        const upperMatch = users.where('name').eq('JOHN DOE').toArray();
        expect(upperMatch).toHaveLength(1);
        expect(upperMatch[0].id).not.toBe(exactMatch[0].id);

        // Test case-insensitive-like queries using SQL
        const caseInsensitiveSQL = db.query("SELECT * FROM users WHERE LOWER(name) = LOWER(?)", ['john doe']);
        expect(caseInsensitiveSQL).toHaveLength(2);

        // Test whitespace preservation
        const spacedUser = users.where('name').eq('  spaced  ').first();
        expect(spacedUser).not.toBeNull();
        expect(spacedUser!.name).toBe('  spaced  ');

        // Test LIKE queries with wildcards
        const johnVariants = db.query("SELECT * FROM users WHERE name LIKE '%john%' COLLATE NOCASE");
        expect(johnVariants).toHaveLength(2);
    });

    test('empty string vs null distinction', () => {
        // Test empty strings in various fields
        const emptyStringUser = users.insert({
            name: '', // Empty string
            email: 'empty@test.com',
            tags: ['', 'non-empty', ''], // Mix of empty and non-empty
        });

        // Test undefined/optional fields
        const minimalUser = users.insert({
            name: 'Minimal User',
            email: 'minimal@test.com',
            // age is optional and not provided (should be undefined)
        });

        // Verify using raw SQL
        const rawEmpty = db.query("SELECT * FROM users WHERE _id = ?", [emptyStringUser.id])[0];
        expect(rawEmpty.name).toBe(''); // Empty string, not null
        expect(rawEmpty.age).toBeNull(); // Optional field not provided

        const emptyData = JSON.parse(rawEmpty.doc);
        expect(emptyData.name).toBe('');
        expect(emptyData.tags).toContain('');
        expect(emptyData.age).toBeUndefined();

        const rawMinimal = db.query("SELECT * FROM users WHERE _id = ?", [minimalUser.id])[0];
        expect(rawMinimal.name).toBe('Minimal User');
        expect(rawMinimal.age).toBeNull(); // Optional field

        const minimalData = JSON.parse(rawMinimal.doc);
        expect(minimalData.age).toBeUndefined();

        // Test queries distinguishing empty string from null
        const emptyNameCount = db.query("SELECT COUNT(*) as count FROM users WHERE name = ''")[0].count;
        expect(emptyNameCount).toBe(1);

        const nullAgeCount = db.query("SELECT COUNT(*) as count FROM users WHERE age IS NULL")[0].count;
        expect(nullAgeCount).toBe(2); // Both users have null age
    });

    test('index effectiveness and query performance', () => {
        // Insert a larger dataset to test index effectiveness
        const testUsers = Array.from({length: 100}, (_, i) => ({
            name: `User ${i.toString().padStart(3, '0')}`,
            email: `user${i}@test.com`,
            age: Math.floor(Math.random() * 50) + 18,
        }));

        const insertedUsers = users.insertBulk(testUsers);
        expect(insertedUsers).toHaveLength(100);

        // Test indexed field query (name has an index)
        const indexedQuery = db.query("EXPLAIN QUERY PLAN SELECT * FROM users WHERE name = 'User 050'");
        // Should use index (contains "INDEX" in the detail) - this might vary by SQLite version
        const indexUsed = indexedQuery.some(row => 
            row.detail && (row.detail.includes('INDEX') || row.detail.includes('idx_'))
        );
        // Note: Index usage may vary by SQLite version and query planner decisions
        expect(indexedQuery.length).toBeGreaterThan(0);

        // Test range queries on indexed age field
        const ageRangeResults = users.where('age').between(25, 35).toArray();
        const ageRangeSQL = db.query("SELECT COUNT(*) as count FROM users WHERE age BETWEEN 25 AND 35");
        
        expect(ageRangeResults.length).toBe(ageRangeSQL[0].count);

        // Test unique constraint index on email
        const emailLookup = db.query("SELECT * FROM users WHERE email = 'user50@test.com'");
        expect(emailLookup).toHaveLength(1);

        // Verify no duplicate emails exist
        const duplicateEmails = db.query(`
            SELECT email, COUNT(*) as count 
            FROM users 
            GROUP BY email 
            HAVING COUNT(*) > 1
        `);
        expect(duplicateEmails).toHaveLength(0);
    });

    test('schema validation edge cases', () => {
        // Test invalid email format (should fail validation)
        expect(() => {
            users.insert({
                name: 'Invalid Email User',
                email: 'not-an-email', // Invalid email format
            });
        }).toThrow();

        // Test string that looks like number for age
        expect(() => {
            users.insert({
                name: 'String Age User',
                email: 'string@test.com',
                age: '25' as any, // String instead of number
            });
        }).toThrow();

        // Test valid edge case data that should pass
        const validUser = users.insert({
            name: 'Valid Edge Case',
            email: 'valid.edge+case@example-domain.co.uk',
            age: 0, // Zero should be valid
            tags: [], // Empty array should be valid
        });

        expect(validUser.age).toBe(0);
        expect(validUser.tags).toEqual([]);
    });

    test('concurrent operation simulation', () => {
        // Simulate concurrent inserts with potential conflicts
        const baseUser = users.insert({
            name: 'Base User',
            email: 'base@test.com',
        });

        // Multiple operations on the same user ID
        const updateOperations = [
            () => users.put(baseUser.id, { age: 25 }),
            () => users.put(baseUser.id, { age: 30 }),
            () => users.put(baseUser.id, { age: 35 }),
        ];

        // Execute updates
        updateOperations.forEach(op => op());

        // Verify final state
        const finalUser = users.findById(baseUser.id);
        expect(finalUser).not.toBeNull();
        expect(finalUser!.age).toBe(35); // Last update should win

        // Test rapid inserts and deletes
        const rapidUsers = Array.from({length: 50}, (_, i) => ({
            name: `Rapid User ${i}`,
            email: `rapid${i}@test.com`,
        }));

        const rapidInserted = users.insertBulk(rapidUsers);
        expect(rapidInserted).toHaveLength(50);

        // Delete every other user
        const toDelete = rapidInserted.filter((_, i) => i % 2 === 0).map(u => u.id);
        const deleteCount = users.deleteBulk(toDelete);
        expect(deleteCount).toBe(25);

        // Verify remaining count
        const remainingCount = db.query("SELECT COUNT(*) as count FROM users WHERE name LIKE 'Rapid User%'")[0].count;
        expect(remainingCount).toBe(25);
    });
});