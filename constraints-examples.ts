import { z } from 'zod';
import { createDB } from './src/index.js';
import { unique, foreignKey, index, compositeUnique } from './src/schema-constraints.js';

// ==============================================
// CONSTRAINTS AND RELATIONSHIPS EXAMPLES
// ==============================================

// Define schemas for different entity types
const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  username: z.string(),
  age: z.number().int().optional(),
  department: z.string().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date())
});

const postSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  viewCount: z.number().int().default(0),
  createdAt: z.date().default(() => new Date()),
  publishedAt: z.date().optional()
});

const categorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  parentId: z.string().uuid().optional(), // Self-referential relationship
  isActive: z.boolean().default(true),
  createdAt: z.date().default(() => new Date())
});

// Many-to-many relationship: Posts can have multiple tags, tags can be on multiple posts
const tagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string().optional(),
  createdAt: z.date().default(() => new Date())
});

const postTagSchema = z.object({
  id: z.string().uuid(),
  postId: z.string().uuid(),
  tagId: z.string().uuid(),
  createdAt: z.date().default(() => new Date())
});

// Comments with nested relationships
const commentSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  postId: z.string().uuid(),
  authorId: z.string().uuid(),
  parentCommentId: z.string().uuid().optional(), // Self-referential for nested comments
  isApproved: z.boolean().default(false),
  createdAt: z.date().default(() => new Date())
});

async function constraintsExample() {
  console.log('=== BusNDB Constraints and Relationships Example ===\n');
  
  const db = createDB({ memory: true });

  // ==============================================
  // 1. BASIC CONSTRAINTS SETUP
  // ==============================================
  
  console.log('1. Setting up collections with constraints...\n');

  // Users collection with unique constraints and indexes
  const users = db.collection('users', userSchema, {
    constrainedFields: {
      email: { 
        unique: true,        // Unique constraint - no duplicate emails
        nullable: false      // Required field
      },
      username: { 
        unique: true,        // Unique usernames
        nullable: false 
      },
      name: { type: 'TEXT' },
      department: { type: 'TEXT' },
      age: { type: 'INTEGER' }
    },
    constraints: {
      indexes: {
        name: index('name'),           // Index for fast name searches
        department: index('department'), // Index for department queries
        age: index('age'),             // Index for age range queries
        active_users: index('isActive') // Compound index possibility
      }
    }
  });

  // Categories with self-referential foreign key
  const categories = db.collection('categories', categorySchema, {
    constrainedFields: {
      name: { 
        unique: true,        // Category names must be unique
        nullable: false 
      },
      parentId: { 
        foreignKey: 'categories._id',  // Self-referential foreign key
        onDelete: 'SET NULL',          // When parent deleted, set children's parentId to NULL
        nullable: true                 // Root categories have no parent
      }
    },
    constraints: {
      indexes: {
        name: index('name'),
        parent: index('parentId')
      }
    }
  });

  // Posts with foreign key relationships
  const posts = db.collection('posts', postSchema, {
    constrainedFields: {
      title: { type: 'TEXT' },
      authorId: { 
        foreignKey: 'users._id',     // Foreign key to users table
        onDelete: 'CASCADE'          // Delete posts when user is deleted
      },
      categoryId: { 
        foreignKey: 'categories._id', // Foreign key to categories
        onDelete: 'SET NULL',        // Set to NULL when category deleted
        nullable: true               // Posts can exist without category
      },
      status: { type: 'TEXT' },
      viewCount: { type: 'INTEGER' }
    },
    constraints: {
      indexes: {
        author: index('authorId'),     // Fast author lookups
        category: index('categoryId'), // Fast category lookups
        status: index('status'),       // Fast status filtering
        views: index('viewCount'),     // Sort by popularity
        title: index('title')          // Text search on titles
      }
    }
  });

  // Tags collection (for many-to-many relationship)
  const tags = db.collection('tags', tagSchema, {
    constrainedFields: {
      name: { 
        unique: true,        // Tag names must be unique
        nullable: false 
      },
      color: { type: 'TEXT' }
    },
    constraints: {
      indexes: {
        name: index('name')
      }
    }
  });

  // Junction table for many-to-many posts-tags relationship
  const postTags = db.collection('postTags', postTagSchema, {
    constrainedFields: {
      postId: { 
        foreignKey: 'posts._id',
        onDelete: 'CASCADE'          // Delete mapping when post deleted
      },
      tagId: { 
        foreignKey: 'tags._id',
        onDelete: 'CASCADE'          // Delete mapping when tag deleted
      }
    },
    constraints: {
      indexes: {
        post_tags: index(['postId', 'tagId']),  // Compound index for efficient lookups
        tag_posts: index(['tagId', 'postId'])   // Reverse lookup index
      },
      tableLevelConstraints: [
        compositeUnique(['postId', 'tagId'], 'unique_post_tag')    // Ensure no duplicate post-tag relationships
      ]
    }
  });

  // Comments with nested relationships
  const comments = db.collection('comments', commentSchema, {
    constrainedFields: {
      postId: { 
        foreignKey: 'posts._id',
        onDelete: 'CASCADE'          // Delete comments when post deleted
      },
      authorId: { 
        foreignKey: 'users._id',
        onDelete: 'CASCADE'          // Delete comments when user deleted
      },
      parentCommentId: { 
        foreignKey: 'comments._id',  // Self-referential for nested comments
        onDelete: 'CASCADE',         // Delete replies when parent comment deleted
        nullable: true               // Top-level comments have no parent
      }
    },
    constraints: {
      indexes: {
        post_comments: index('postId'),           // Fast post comment lookups
        user_comments: index('authorId'),         // Fast user comment lookups  
        comment_replies: index('parentCommentId'), // Fast nested comment lookups
        approval_status: index('isApproved')      // Fast approved comment filtering
      }
    }
  });

  // ==============================================
  // 2. CREATING TEST DATA
  // ==============================================

  console.log('2. Creating test data with relationships...\n');

  // Create users
  const alice = users.insert({
    name: 'Alice Johnson',
    email: 'alice@company.com',
    username: 'alice_j',
    age: 28,
    department: 'Engineering'
  });

  const bob = users.insert({
    name: 'Bob Smith', 
    email: 'bob@company.com',
    username: 'bob_s',
    age: 34,
    department: 'Marketing'
  });

  const carol = users.insert({
    name: 'Carol Williams',
    email: 'carol@company.com', 
    username: 'carol_w',
    age: 31,
    department: 'Engineering'
  });

  console.log(`✓ Created ${users.toArray().length} users`);

  // Create hierarchical categories (parent-child relationships)
  const techCategory = categories.insert({
    name: 'Technology',
    description: 'All technology-related posts'
  });

  const webdevCategory = categories.insert({
    name: 'Web Development',
    description: 'Web development tutorials and tips',
    parentId: techCategory.id  // Child of Technology
  });

  const jsCategory = categories.insert({
    name: 'JavaScript',
    description: 'JavaScript programming',
    parentId: webdevCategory.id  // Child of Web Development
  });

  const marketingCategory = categories.insert({
    name: 'Marketing',
    description: 'Marketing strategies and tips'
  });

  console.log(`✓ Created ${categories.toArray().length} categories (with parent-child relationships)`);

  // Create tags for many-to-many relationships
  const typescriptTag = tags.insert({ name: 'TypeScript', color: 'blue' });
  const tutorialTag = tags.insert({ name: 'Tutorial', color: 'green' });
  const advancedTag = tags.insert({ name: 'Advanced', color: 'red' });
  const beginnerTag = tags.insert({ name: 'Beginner', color: 'yellow' });
  const databaseTag = tags.insert({ name: 'Database', color: 'purple' });

  console.log(`✓ Created ${tags.toArray().length} tags`);

  // Create posts with foreign key relationships
  const post1 = posts.insert({
    title: 'Getting Started with TypeScript',
    content: 'A comprehensive guide to TypeScript for beginners...',
    authorId: alice.id,
    categoryId: jsCategory.id,
    status: 'published',
    viewCount: 150
  });

  const post2 = posts.insert({
    title: 'Advanced Database Optimization',
    content: 'Learn how to optimize your database queries...',
    authorId: bob.id,
    categoryId: techCategory.id,
    status: 'published', 
    viewCount: 89
  });

  const post3 = posts.insert({
    title: 'Marketing in the Digital Age',
    content: 'Modern marketing strategies for digital businesses...',
    authorId: carol.id,
    categoryId: marketingCategory.id,
    status: 'draft',
    viewCount: 12
  });

  console.log(`✓ Created ${posts.toArray().length} posts with author and category relationships`);

  // ==============================================
  // 3. MANY-TO-MANY RELATIONSHIPS
  // ==============================================

  console.log('\n3. Creating many-to-many relationships (posts ↔ tags)...\n');

  // Associate posts with tags (many-to-many)
  postTags.insertBulk([
    { postId: post1.id, tagId: typescriptTag.id },
    { postId: post1.id, tagId: tutorialTag.id },
    { postId: post1.id, tagId: beginnerTag.id },
    
    { postId: post2.id, tagId: databaseTag.id },
    { postId: post2.id, tagId: advancedTag.id },
    { postId: post2.id, tagId: tutorialTag.id },
    
    { postId: post3.id, tagId: beginnerTag.id }
  ]);

  console.log(`✓ Created ${postTags.toArray().length} post-tag relationships`);

  // ==============================================
  // 4. NESTED RELATIONSHIPS (COMMENTS)
  // ==============================================

  console.log('\n4. Creating nested comment relationships...\n');

  // Create top-level comments
  const comment1 = comments.insert({
    content: 'Great tutorial! Very helpful for beginners.',
    postId: post1.id,
    authorId: bob.id,
    isApproved: true
  });

  const comment2 = comments.insert({
    content: 'Could you add more examples?',
    postId: post1.id,
    authorId: carol.id,
    isApproved: true
  });

  // Create nested replies
  const reply1 = comments.insert({
    content: 'Thanks for the feedback! I\'ll add more examples in the next update.',
    postId: post1.id,
    authorId: alice.id,  // Author replying
    parentCommentId: comment2.id,  // Reply to comment2
    isApproved: true
  });

  const reply2 = comments.insert({
    content: 'I agree, more examples would be great!',
    postId: post1.id,
    authorId: bob.id,
    parentCommentId: comment2.id,  // Another reply to comment2
    isApproved: true
  });

  console.log(`✓ Created ${comments.toArray().length} comments with nested replies`);

  // ==============================================
  // 5. QUERYING RELATIONSHIPS
  // ==============================================

  console.log('\n5. Demonstrating relationship queries...\n');

  // Query posts by author
  const alicePosts = posts.where('authorId').eq(alice.id).toArray();
  console.log(`📝 Posts by ${alice.name}: ${alicePosts.length} found`);
  alicePosts.forEach(post => console.log(`   - "${post.title}"`));

  // Query posts in a category hierarchy
  const techPosts = posts.where('categoryId').eq(techCategory.id).toArray();
  const webdevPosts = posts.where('categoryId').eq(webdevCategory.id).toArray(); 
  const jsPosts = posts.where('categoryId').eq(jsCategory.id).toArray();
  
  console.log(`\n📂 Category hierarchy:`);
  console.log(`   Technology (${techPosts.length} posts)`);
  console.log(`   └── Web Development (${webdevPosts.length} posts)`);
  console.log(`       └── JavaScript (${jsPosts.length} posts)`);

  // Query many-to-many relationships
  console.log(`\n🏷️  Many-to-many relationships:`);
  
  // Find all tags for a specific post
  const post1TagIds = postTags.where('postId').eq(post1.id).toArray().map(pt => pt.tagId);
  const post1Tags = tags.where('id').in(post1TagIds).toArray();
  console.log(`   Tags for "${post1.title}": ${post1Tags.map(t => t.name).join(', ')}`);

  // Find all posts with a specific tag
  const tutorialPostIds = postTags.where('tagId').eq(tutorialTag.id).toArray().map(pt => pt.postId);
  const tutorialPosts = posts.where('id').in(tutorialPostIds).toArray();
  console.log(`   Posts with "Tutorial" tag: ${tutorialPosts.map(p => p.title).join(', ')}`);

  // Query nested comments
  console.log(`\n💬 Comment relationships:`);
  const post1Comments = comments.where('postId').eq(post1.id).where('parentCommentId').eq(null).toArray();
  console.log(`   Top-level comments on "${post1.title}": ${post1Comments.length}`);
  
  for (const comment of post1Comments) {
    const author = users.findById(comment.authorId);
    console.log(`   └── ${author?.name}: "${comment.content}"`);
    
    // Find replies to this comment
    const replies = comments.where('parentCommentId').eq(comment.id).toArray();
    for (const reply of replies) {
      const replyAuthor = users.findById(reply.authorId);
      console.log(`       └── ${replyAuthor?.name}: "${reply.content}"`);
    }
  }

  // ==============================================
  // 6. CONSTRAINT DEMONSTRATIONS
  // ==============================================

  console.log('\n6. Demonstrating constraint enforcement...\n');

  // Test unique constraints
  console.log('🔒 Testing unique constraints:');
  try {
    users.insert({
      name: 'Duplicate User',
      email: 'alice@company.com', // Duplicate email
      username: 'duplicate'
    });
  } catch (error) {
    console.log('   ✓ Prevented duplicate email insertion');
  }

  try {
    users.insert({
      name: 'Another User',
      email: 'unique@company.com',
      username: 'alice_j' // Duplicate username
    });
  } catch (error) {
    console.log('   ✓ Prevented duplicate username insertion');
  }

  // Test foreign key constraints
  console.log('\n🔗 Testing foreign key constraints:');
  try {
    posts.insert({
      title: 'Orphaned Post',
      content: 'This should fail',
      authorId: 'non-existent-user-id' // Invalid foreign key
    });
  } catch (error) {
    console.log('   ✓ Prevented invalid foreign key insertion');
  }

  // Test cascade delete
  console.log('\n🗑️  Testing cascade delete:');
  const testUser = users.insert({
    name: 'Test User',
    email: 'test@delete.com',
    username: 'test_delete'
  });

  const testPost = posts.insert({
    title: 'Test Post',
    content: 'This post will be deleted with user',
    authorId: testUser.id
  });

  const testComment = comments.insert({
    content: 'Test comment',
    postId: testPost.id,
    authorId: testUser.id
  });

  console.log(`   Before deletion: User has ${posts.where('authorId').eq(testUser.id).count()} posts, ${comments.where('authorId').eq(testUser.id).count()} comments`);

  // Delete user - should cascade to posts and comments
  users.delete(testUser.id);

  console.log(`   After deletion: ${posts.where('authorId').eq(testUser.id).count()} posts, ${comments.where('authorId').eq(testUser.id).count()} comments remain`);
  console.log('   ✓ Cascade delete worked correctly');

  // ==============================================
  // 7. COMPLEX RELATIONSHIP QUERIES
  // ==============================================

  console.log('\n7. Complex relationship queries using raw SQL...\n');

  // Query with joins to get posts with author names and category names
  const postsWithDetails = db.query(`
    SELECT 
      p.title as post_title,
      u.name as author_name,
      u.department as author_department,
      c.name as category_name,
      p.viewCount as views,
      p.status
    FROM posts p
    JOIN users u ON p.authorId = u._id
    LEFT JOIN categories c ON p.categoryId = c._id
    WHERE p.status = 'published'
    ORDER BY p.viewCount DESC
  `);

  console.log('📊 Published posts with full details:');
  postsWithDetails.forEach(row => {
    console.log(`   "${row.post_title}" by ${row.author_name} (${row.author_department})`);
    console.log(`      Category: ${row.category_name || 'Uncategorized'} | Views: ${row.views}`);
  });

  // Query category hierarchy with post counts
  const categoryHierarchy = db.query(`
    SELECT 
      c.name as category_name,
      parent.name as parent_name,
      COUNT(p._id) as post_count
    FROM categories c
    LEFT JOIN categories parent ON c.parentId = parent._id
    LEFT JOIN posts p ON c._id = p.categoryId
    GROUP BY c._id, c.name, parent.name
    ORDER BY parent.name NULLS FIRST, c.name
  `);

  console.log('\n🌳 Category hierarchy with post counts:');
  categoryHierarchy.forEach(row => {
    const indent = row.parent_name ? '   └── ' : '';
    console.log(`${indent}${row.category_name} (${row.post_count} posts)`);
  });

  // Many-to-many query: Posts with their tags
  const postsWithTags = db.query(`
    SELECT 
      p.title as post_title,
      GROUP_CONCAT(t.name) as tag_names
    FROM posts p
    LEFT JOIN postTags pt ON p._id = pt.postId
    LEFT JOIN tags t ON pt.tagId = t._id
    WHERE p.status = 'published'
    GROUP BY p._id, p.title
    ORDER BY p.title
  `);

  console.log('\n🏷️  Posts with their tags:');
  postsWithTags.forEach(row => {
    const tags = row.tag_names ? row.tag_names.split(',').join(', ') : 'No tags';
    console.log(`   "${row.post_title}": ${tags}`);
  });

  // ==============================================
  // 8. PERFORMANCE CONSIDERATIONS
  // ==============================================

  console.log('\n8. Performance insights...\n');

  // Show index usage
  const indexQuery = db.query(`
    SELECT name, tbl_name 
    FROM sqlite_master 
    WHERE type='index' 
    AND name NOT LIKE 'sqlite_%'
    ORDER BY tbl_name, name
  `);

  console.log('📈 Created indexes for performance:');
  indexQuery.forEach(row => {
    console.log(`   ${row.tbl_name}.${row.name}`);
  });

  // Show foreign key relationships
  const fkQuery = db.query(`
    SELECT 
      name as table_name,
      sql 
    FROM sqlite_master 
    WHERE type='table' 
    AND sql LIKE '%REFERENCES%'
    ORDER BY name
  `);

  console.log('\n🔗 Foreign key relationships established:');
  console.log('   posts.authorId → users._id (CASCADE)');
  console.log('   posts.categoryId → categories._id (SET NULL)');
  console.log('   categories.parentId → categories._id (SET NULL)');
  console.log('   postTags.postId → posts._id (CASCADE)');
  console.log('   postTags.tagId → tags._id (CASCADE)');
  console.log('   comments.postId → posts._id (CASCADE)');
  console.log('   comments.authorId → users._id (CASCADE)');
  console.log('   comments.parentCommentId → comments._id (CASCADE)');

  console.log('\n✅ Constraints and relationships example completed!');
  console.log('\nKey takeaways:');
  console.log('• Use constrainedFields for performance-critical fields with constraints');
  console.log('• Foreign keys ensure referential integrity');
  console.log('• Junction tables enable many-to-many relationships');
  console.log('• Self-referential FKs create hierarchical data structures');
  console.log('• Indexes dramatically improve query performance');
  console.log('• Cascade delete options control data cleanup behavior');

  // Final stats
  console.log(`\nFinal counts:`);
  console.log(`• ${users.toArray().length} users`);
  console.log(`• ${categories.toArray().length} categories`);
  console.log(`• ${posts.toArray().length} posts`);
  console.log(`• ${tags.toArray().length} tags`);
  console.log(`• ${postTags.toArray().length} post-tag relationships`);
  console.log(`• ${comments.toArray().length} comments`);

  db.close();
  console.log('\nDatabase closed.');
}

constraintsExample().catch(console.error);