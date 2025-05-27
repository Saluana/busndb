import { z } from 'zod';
import { createDB } from './src/index.js';

const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().optional(),
  createdAt: z.date().default(() => new Date())
});

const postSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.string().uuid(),
  published: z.boolean().default(false),
  createdAt: z.date().default(() => new Date())
});

async function example() {
  const db = createDB({ memory: true });

  const users = db.collection('users', userSchema);
  const posts = db.collection('posts', postSchema);

  console.log('=== BusNDB Example ===\n');

  console.log('1. Creating users...');
  const user1 = users.insert({
    name: 'Alice Johnson',
    email: 'alice@example.com',
    age: 28
  });
  
  const user2 = users.insert({
    name: 'Bob Smith',
    email: 'bob@example.com',
    age: 34
  });

  console.log(`Created users: ${user1.name} (${user1.id}) and ${user2.name} (${user2.id})\n`);

  console.log('2. Creating posts...');
  const post1 = posts.insert({
    title: 'Getting Started with BusNDB',
    content: 'BusNDB is a fast, type-safe NoSQL database built on SQLite.',
    authorId: user1.id,
    published: true
  });

  const post2 = posts.insert({
    title: 'Advanced Querying',
    content: 'Learn how to write complex queries with BusNDB.',
    authorId: user2.id,
    published: false
  });

  console.log(`Created posts: "${post1.title}" and "${post2.title}"\n`);

  console.log('3. Querying data...');
  
  const adults = users.where('age').gte(30).toArray();
  console.log(`Users 30 or older: ${adults.map(u => u.name).join(', ')}`);

  const publishedPosts = posts.where('published').eq(true).toArray();
  console.log(`Published posts: ${publishedPosts.map(p => p.title).join(', ')}`);

  const recentPosts = posts
    .where('published').eq(true)
    .orderBy('createdAt', 'desc')
    .limit(5)
    .toArray();
  console.log(`Recent published posts: ${recentPosts.length} found`);

  console.log('\n4. Updating data...');
  const updatedPost = posts.put(post2.id, { published: true });
  console.log(`Published post: "${updatedPost.title}"`);

  console.log('\n5. Complex queries...');
  const authoredBy = posts.where('authorId').eq(user1.id).toArray();
  console.log(`Posts by ${user1.name}: ${authoredBy.length} found`);

  const postCount = posts.where('published').eq(true).count();
  console.log(`Total published posts: ${postCount}`);

  console.log('\n6. Bulk operations...');
  const newUsers = users.insertBulk([
    { name: 'Charlie Brown', email: 'charlie@example.com', age: 25 },
    { name: 'Diana Prince', email: 'diana@example.com', age: 30 }
  ]);
  console.log(`Bulk inserted ${newUsers.length} users`);

  console.log('\n7. Transaction example...');
  await db.transaction(async () => {
    users.insert({ name: 'Eve Wilson', email: 'eve@example.com', age: 27 });
    posts.insert({
      title: 'Transaction Test',
      content: 'This post was created in a transaction.',
      authorId: user1.id,
      published: true
    });
  });
  console.log('Transaction completed successfully');

  console.log(`\nFinal counts: ${users.toArray().length} users, ${posts.toArray().length} posts`);

  db.close();
  console.log('\nDatabase closed.');
}

example().catch(console.error);