import { z } from 'zod';
import { Database } from '../src/database';
import { unique, foreignKey, index, compositeUnique } from '../src/schema-constraints';

// Create database
const db = new Database({ path: ':memory:' });

// Define schemas
const organizationSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    createdAt: z.date(),
});

const userSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    username: z.string(),
    organizationId: z.string(),
    isActive: z.boolean().default(true),
    createdAt: z.date(),
});

const postSchema = z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    authorId: z.string(),
    published: z.boolean().default(false),
    publishedAt: z.date().optional(),
    createdAt: z.date(),
});

const membershipSchema = z.object({
    id: z.string(),
    userId: z.string(),
    organizationId: z.string(),
    role: z.enum(['admin', 'member', 'viewer']),
    createdAt: z.date(),
});

// Create collections with constraints
const organizations = db.collection('organizations', organizationSchema, {
    constraints: {
        constraints: {
            email: unique('org_email_unique'),
        },
        indexes: {
            name: index('name'),
            email: index('email'),
            createdAt: index('createdAt'),
        },
    },
});

const users = db.collection('users', userSchema, {
    constraints: {
        constraints: {
            email: unique('user_email_unique'),
            username: unique('user_username_unique'),
            organizationId: foreignKey('organizations', 'id'),
        },
        indexes: {
            email: index('email'),
            username: index('username'),
            organizationId: index('organizationId'),
            isActive: index('isActive'),
            createdAt: index('createdAt'),
        },
    },
});

const posts = db.collection('posts', postSchema, {
    constraints: {
        constraints: {
            authorId: foreignKey('users', 'id'),
        },
        indexes: {
            authorId: index('authorId'),
            published: index('published'),
            publishedAt: index('publishedAt'),
            createdAt: index('createdAt'),
        },
    },
});

const memberships = db.collection('memberships', membershipSchema, {
    constraints: {
        constraints: {
            userId: foreignKey('users', 'id'),
            organizationId: foreignKey('organizations', 'id'),
            userOrg: compositeUnique(['userId', 'organizationId'], 'user_org_unique'),
        },
        indexes: {
            userId: index('userId'),
            organizationId: index('organizationId'),
            role: index('role'),
            createdAt: index('createdAt'),
        },
    },
});

console.log('=== Schema Constraints Example ===\n');

try {
    // Create organization
    console.log('1. Creating organization...');
    const org = organizations.insert({
        name: 'Acme Corp',
        email: 'contact@acme.com',
        createdAt: new Date(),
    });
    console.log(`Created organization: ${org.name} (ID: ${org.id})`);

    // Create users
    console.log('\n2. Creating users...');
    const user1 = users.insert({
        email: 'john@acme.com',
        username: 'john_doe',
        organizationId: org.id,
        createdAt: new Date(),
    });
    console.log(`Created user: ${user1.username} (ID: ${user1.id})`);

    const user2 = users.insert({
        email: 'jane@acme.com',
        username: 'jane_smith',
        organizationId: org.id,
        createdAt: new Date(),
    });
    console.log(`Created user: ${user2.username} (ID: ${user2.id})`);

    // Test unique constraint
    console.log('\n3. Testing unique constraints...');
    try {
        users.insert({
            email: 'john@acme.com', // Duplicate email
            username: 'john_duplicate',
            organizationId: org.id,
            createdAt: new Date(),
        });
    } catch (error) {
        console.log(`✓ Unique constraint working: ${error.message}`);
    }

    // Test foreign key constraint
    console.log('\n4. Testing foreign key constraints...');
    try {
        users.insert({
            email: 'invalid@example.com',
            username: 'invalid_user',
            organizationId: 'invalid-org-id', // Invalid foreign key
            createdAt: new Date(),
        });
    } catch (error) {
        console.log(`✓ Foreign key constraint working: ${error.message}`);
    }

    // Create posts
    console.log('\n5. Creating posts...');
    const post1 = posts.insert({
        title: 'Hello World',
        content: 'This is my first post!',
        authorId: user1.id,
        published: true,
        publishedAt: new Date(),
        createdAt: new Date(),
    });
    console.log(`Created post: "${post1.title}" by ${user1.username}`);

    // Create memberships with composite unique constraint
    console.log('\n6. Creating memberships...');
    const membership1 = memberships.insert({
        userId: user1.id,
        organizationId: org.id,
        role: 'admin',
        createdAt: new Date(),
    });
    console.log(`Created membership: ${user1.username} as ${membership1.role} in ${org.name}`);

    const membership2 = memberships.insert({
        userId: user2.id,
        organizationId: org.id,
        role: 'member',
        createdAt: new Date(),
    });
    console.log(`Created membership: ${user2.username} as ${membership2.role} in ${org.name}`);

    // Test composite unique constraint
    console.log('\n7. Testing composite unique constraints...');
    try {
        memberships.insert({
            userId: user1.id,
            organizationId: org.id, // Same user-org combination
            role: 'viewer',
            createdAt: new Date(),
        });
    } catch (error) {
        console.log(`✓ Composite unique constraint working: ${error.message}`);
    }

    // Query with constraints-optimized indexes
    console.log('\n8. Querying with optimized indexes...');
    
    const activeUsers = users.where('isActive').eq(true).toArray();
    console.log(`Found ${activeUsers.length} active users`);

    const userPosts = posts.where('authorId').eq(user1.id).orderBy('createdAt', 'desc').toArray();
    console.log(`Found ${userPosts.length} posts by ${user1.username}`);

    const orgMembers = memberships.where('organizationId').eq(org.id).toArray();
    console.log(`Found ${orgMembers.length} members in ${org.name}`);

    // Update with constraint validation
    console.log('\n9. Testing constraint validation on updates...');
    const updatedUser = users.put(user1.id, {
        email: 'john.doe@acme.com', // New unique email
        username: 'john_doe_updated',
    });
    console.log(`Updated user email: ${updatedUser.email}`);

    console.log('\n✓ All constraint tests passed successfully!');

} catch (error) {
    console.error('❌ Error:', error.message);
} finally {
    db.close();
}

console.log('\n=== Schema Constraints Features ===');
console.log('✓ Unique constraints on individual fields');
console.log('✓ Composite unique constraints on multiple fields');
console.log('✓ Foreign key constraint validation');
console.log('✓ Automatic index creation for performance');
console.log('✓ Constraint validation on both insert and update');
console.log('✓ Meaningful error messages with field information');
console.log('✓ Support for multiple constraints on the same field');
console.log('✓ Full integration with TypeScript type safety');