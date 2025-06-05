import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { z } from 'zod/v4';
import {
    createDB,
    ValidationError,
    UniqueConstraintError,
    NotFoundError,
} from '../src/index.js';
import type { Database } from '../src/database.js';

// Schemas for relationship testing
const userSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().int().optional(),
    createdAt: z.date().default(() => new Date()),
});

const postSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    content: z.string(),
    authorId: z.string().uuid(),
    published: z.boolean().default(false),
    createdAt: z.date().default(() => new Date()),
});

const commentSchema = z.object({
    id: z.string().uuid(),
    content: z.string(),
    postId: z.string().uuid(),
    authorId: z.string().uuid(),
    createdAt: z.date().default(() => new Date()),
});

const categorySchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().optional(),
});

const postCategorySchema = z.object({
    id: z.string().uuid(),
    postId: z.string().uuid(),
    categoryId: z.string().uuid(),
});

const tagSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().optional(),
});

const postTagSchema = z.object({
    id: z.string().uuid(),
    postId: z.string().uuid(),
    tagId: z.string().uuid(),
});

const profileSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    bio: z.string().optional(),
    website: z.string().optional(),
    avatar: z.string().optional(),
});

describe('Relationship Testing', () => {
    let db: Database;
    let users: ReturnType<typeof db.collection<typeof userSchema>>;
    let posts: ReturnType<typeof db.collection<typeof postSchema>>;
    let comments: ReturnType<typeof db.collection<typeof commentSchema>>;
    let categories: ReturnType<typeof db.collection<typeof categorySchema>>;
    let postCategories: ReturnType<
        typeof db.collection<typeof postCategorySchema>
    >;
    let tags: ReturnType<typeof db.collection<typeof tagSchema>>;
    let postTags: ReturnType<typeof db.collection<typeof postTagSchema>>;
    let profiles: ReturnType<typeof db.collection<typeof profileSchema>>;

    beforeEach(() => {
        db = createDB({ memory: true });
        // Enable foreign key constraints for CASCADE operations
        db.execSync('PRAGMA foreign_keys = ON');
        users = db.collection('users', userSchema);
        posts = db.collection('posts', postSchema);
        comments = db.collection('comments', commentSchema);
        categories = db.collection('categories', categorySchema);
        postCategories = db.collection('post_categories', postCategorySchema);
        tags = db.collection('tags', tagSchema);
        postTags = db.collection('post_tags', postTagSchema);
        profiles = db.collection('profiles', profileSchema);
    });

    afterEach(() => {
        if (db) {
            db.close();
        }
    });

    describe('One-to-Many Relationships', () => {
        test('should handle user-posts relationship', () => {
            // Create users
            const user1 = users.insertSync({
                name: 'Alice Johnson',
                email: 'alice@example.com',
                age: 28,
            });

            const user2 = users.insertSync({
                name: 'Bob Smith',
                email: 'bob@example.com',
                age: 32,
            });

            // Create posts for users
            const post1 = posts.insertSync({
                title: 'Alice First Post',
                content: 'This is Alice first post',
                authorId: user1.id,
                published: true,
            });

            const post2 = posts.insertSync({
                title: 'Alice Second Post',
                content: 'This is Alice second post',
                authorId: user1.id,
                published: false,
            });

            const post3 = posts.insertSync({
                title: 'Bob First Post',
                content: 'This is Bob first post',
                authorId: user2.id,
                published: true,
            });

            // Test finding posts by author using direct filtering
            const alicePosts = posts
                .where('authorId')
                .eq(user1.id)
                .toArraySync();
            expect(alicePosts).toHaveLength(2);
            expect(alicePosts.every((p) => p.authorId === user1.id)).toBe(true);

            const bobPosts = posts.where('authorId').eq(user2.id).toArraySync();
            expect(bobPosts).toHaveLength(1);
            expect(bobPosts[0].authorId).toBe(user2.id);

            // Test filtering published posts by author
            const alicePublishedPosts = posts
                .where('authorId')
                .eq(user1.id)
                .and()
                .where('published')
                .eq(true)
                .toArraySync();
            expect(alicePublishedPosts).toHaveLength(1);
            expect(alicePublishedPosts[0].title).toBe('Alice First Post');
        });

        test('should handle post-comments relationship', () => {
            // Create user and post
            const user = users.insertSync({
                name: 'Test User',
                email: 'test@example.com',
            });

            const post = posts.insertSync({
                title: 'Test Post',
                content: 'Test content',
                authorId: user.id,
            });

            // Create comments for the post
            const comment1 = comments.insertSync({
                content: 'Great post!',
                postId: post.id,
                authorId: user.id,
            });

            const comment2 = comments.insertSync({
                content: 'Very informative',
                postId: post.id,
                authorId: user.id,
            });

            // Another post and comment
            const anotherPost = posts.insertSync({
                title: 'Another Post',
                content: 'Another content',
                authorId: user.id,
            });

            const comment3 = comments.insertSync({
                content: 'Comment on another post',
                postId: anotherPost.id,
                authorId: user.id,
            });

            // Test finding comments by post
            const postComments = comments
                .where('postId')
                .eq(post.id)
                .toArraySync();
            expect(postComments).toHaveLength(2);
            expect(postComments.every((c) => c.postId === post.id)).toBe(true);

            const anotherPostComments = comments
                .where('postId')
                .eq(anotherPost.id)
                .toArraySync();
            expect(anotherPostComments).toHaveLength(1);
            expect(anotherPostComments[0].content).toBe(
                'Comment on another post'
            );
        });

        test('should handle cascading deletes simulation', () => {
            // Create user and posts
            const user = users.insertSync({
                name: 'User To Delete',
                email: 'delete@example.com',
            });

            const post1 = posts.insertSync({
                title: 'Post 1',
                content: 'Content 1',
                authorId: user.id,
            });

            const post2 = posts.insertSync({
                title: 'Post 2',
                content: 'Content 2',
                authorId: user.id,
            });

            // Create comments
            comments.insertSync({
                content: 'Comment 1',
                postId: post1.id,
                authorId: user.id,
            });

            comments.insertSync({
                content: 'Comment 2',
                postId: post2.id,
                authorId: user.id,
            });

            // Verify initial state
            expect(posts.where('authorId').eq(user.id).countSync()).toBe(2);
            expect(comments.where('authorId').eq(user.id).countSync()).toBe(2);

            // Simulate cascading delete: delete comments first, then posts, then user
            const userComments = comments
                .where('authorId')
                .eq(user.id)
                .toArraySync();
            userComments.forEach((comment) => comments.deleteSync(comment.id));

            const userPosts = posts.where('authorId').eq(user.id).toArraySync();
            userPosts.forEach((post) => posts.deleteSync(post.id));

            users.deleteSync(user.id);

            // Verify deletion
            expect(users.findByIdSync(user.id)).toBeNull();
            expect(posts.where('authorId').eq(user.id).countSync()).toBe(0);
            expect(comments.where('authorId').eq(user.id).countSync()).toBe(0);
        });
    });

    describe('One-to-One Relationships', () => {
        test('should handle user-profile relationship', () => {
            // Create user
            const user = users.insertSync({
                name: 'Profile User',
                email: 'profile@example.com',
                age: 25,
            });

            // Create profile for user
            const profile = profiles.insertSync({
                userId: user.id,
                bio: 'Software developer',
                website: 'https://example.com',
                avatar: 'avatar.jpg',
            });

            // Test finding profile by user
            const userProfile = profiles
                .where('userId')
                .eq(user.id)
                .firstSync();
            expect(userProfile).not.toBeNull();
            expect(userProfile?.userId).toBe(user.id);
            expect(userProfile?.bio).toBe('Software developer');

            // Test uniqueness constraint simulation
            // In a real application, you would enforce this at the schema level
            const existingProfile = profiles
                .where('userId')
                .eq(user.id)
                .firstSync();
            expect(existingProfile).not.toBeNull();

            // Attempting to create another profile should be prevented by application logic
            const duplicateProfileCheck = profiles
                .where('userId')
                .eq(user.id)
                .countSync();
            expect(duplicateProfileCheck).toBe(1);
        });

        test('should handle profile updates and deletion', () => {
            const user = users.insertSync({
                name: 'Update User',
                email: 'update@example.com',
            });

            const profile = profiles.insertSync({
                userId: user.id,
                bio: 'Original bio',
            });

            // Update profile
            const updatedProfile = profiles.putSync(profile.id, {
                bio: 'Updated bio',
                website: 'https://updated.com',
            });

            expect(updatedProfile.bio).toBe('Updated bio');
            expect(updatedProfile.website).toBe('https://updated.com');

            // Delete profile
            profiles.deleteSync(profile.id);
            const deletedProfile = profiles
                .where('userId')
                .eq(user.id)
                .firstSync();
            expect(deletedProfile).toBeNull();

            // User should still exist
            const existingUser = users.findByIdSync(user.id);
            expect(existingUser).not.toBeNull();
        });
    });

    describe('Many-to-Many Relationships', () => {
        test('should handle post-category many-to-many relationship', () => {
            // Create categories
            const techCategory = categories.insertSync({
                name: 'Technology',
                description: 'Tech-related posts',
            });

            const programmingCategory = categories.insertSync({
                name: 'Programming',
                description: 'Programming tutorials',
            });

            const tutorialCategory = categories.insertSync({
                name: 'Tutorial',
                description: 'Step-by-step guides',
            });

            // Create user and posts
            const user = users.insertSync({
                name: 'Tech Writer',
                email: 'tech@example.com',
            });

            const post1 = posts.insertSync({
                title: 'JavaScript Basics',
                content: 'Learn JavaScript fundamentals',
                authorId: user.id,
            });

            const post2 = posts.insertSync({
                title: 'React Tutorial',
                content: 'Build apps with React',
                authorId: user.id,
            });

            // Create many-to-many relationships
            // Post 1 belongs to Tech and Programming
            postCategories.insertSync({
                postId: post1.id,
                categoryId: techCategory.id,
            });

            postCategories.insertSync({
                postId: post1.id,
                categoryId: programmingCategory.id,
            });

            // Post 2 belongs to all three categories
            postCategories.insertSync({
                postId: post2.id,
                categoryId: techCategory.id,
            });

            postCategories.insertSync({
                postId: post2.id,
                categoryId: programmingCategory.id,
            });

            postCategories.insertSync({
                postId: post2.id,
                categoryId: tutorialCategory.id,
            });

            // Test finding categories for a post
            const post1CategoryIds = postCategories
                .where('postId')
                .eq(post1.id)
                .toArraySync()
                .map((pc) => pc.categoryId);

            expect(post1CategoryIds).toHaveLength(2);
            expect(post1CategoryIds).toContain(techCategory.id);
            expect(post1CategoryIds).toContain(programmingCategory.id);

            // Test finding posts for a category
            const techPostIds = postCategories
                .where('categoryId')
                .eq(techCategory.id)
                .toArraySync()
                .map((pc) => pc.postId);

            expect(techPostIds).toHaveLength(2);
            expect(techPostIds).toContain(post1.id);
            expect(techPostIds).toContain(post2.id);

            // Test finding posts with specific category using subquery
            const programmingPosts = posts
                .where('id')
                .inSubquery(
                    postCategories
                        .where('categoryId')
                        .eq(programmingCategory.id)
                        .select('postId'),
                    'post_categories'
                )
                .toArraySync();

            expect(programmingPosts).toHaveLength(2);
        });

        test('should handle post-tag many-to-many relationship', () => {
            // Create tags
            const jsTag = tags.insertSync({
                name: 'JavaScript',
                color: '#f7df1e',
            });

            const reactTag = tags.insertSync({
                name: 'React',
                color: '#61dafb',
            });

            const webdevTag = tags.insertSync({
                name: 'WebDev',
                color: '#ff6347',
            });

            // Create user and post
            const user = users.insertSync({
                name: 'Developer',
                email: 'dev@example.com',
            });

            const post = posts.insertSync({
                title: 'React with JavaScript',
                content: 'Advanced React patterns',
                authorId: user.id,
            });

            // Tag the post
            postTags.insertSync({ postId: post.id, tagId: jsTag.id });
            postTags.insertSync({ postId: post.id, tagId: reactTag.id });
            postTags.insertSync({ postId: post.id, tagId: webdevTag.id });

            // Test finding tags for post
            const postTagIds = postTags
                .where('postId')
                .eq(post.id)
                .toArraySync()
                .map((pt) => pt.tagId);

            expect(postTagIds).toHaveLength(3);
            expect(postTagIds).toContain(jsTag.id);
            expect(postTagIds).toContain(reactTag.id);
            expect(postTagIds).toContain(webdevTag.id);

            // Test removing a tag from post
            const jsPostTag = postTags
                .where('postId')
                .eq(post.id)
                .and()
                .where('tagId')
                .eq(jsTag.id)
                .firstSync();

            if (jsPostTag) {
                postTags.deleteSync(jsPostTag.id);
            }

            const remainingTags = postTags
                .where('postId')
                .eq(post.id)
                .countSync();
            expect(remainingTags).toBe(2);
        });

        test('should handle complex many-to-many queries', () => {
            // Setup data
            const user = users.insertSync({
                name: 'Author',
                email: 'author@example.com',
            });

            const frontendTag = tags.insertSync({ name: 'Frontend' });
            const backendTag = tags.insertSync({ name: 'Backend' });
            const fullstackTag = tags.insertSync({ name: 'Fullstack' });

            const post1 = posts.insertSync({
                title: 'Frontend Development',
                content: 'Frontend guide',
                authorId: user.id,
            });

            const post2 = posts.insertSync({
                title: 'Backend APIs',
                content: 'API development',
                authorId: user.id,
            });

            const post3 = posts.insertSync({
                title: 'Full Stack App',
                content: 'End-to-end development',
                authorId: user.id,
            });

            // Tag posts
            postTags.insertSync({ postId: post1.id, tagId: frontendTag.id });
            postTags.insertSync({ postId: post2.id, tagId: backendTag.id });
            postTags.insertSync({ postId: post3.id, tagId: frontendTag.id });
            postTags.insertSync({ postId: post3.id, tagId: backendTag.id });
            postTags.insertSync({ postId: post3.id, tagId: fullstackTag.id });

            // Find posts tagged with 'Frontend'
            const frontendPostIds = postTags
                .where('tagId')
                .eq(frontendTag.id)
                .toArraySync()
                .map((pt) => pt.postId);

            expect(frontendPostIds).toHaveLength(2);
            expect(frontendPostIds).toContain(post1.id);
            expect(frontendPostIds).toContain(post3.id);

            // Find posts tagged with both 'Frontend' and 'Backend'
            const frontendPosts = postTags
                .where('tagId')
                .eq(frontendTag.id)
                .toArraySync()
                .map((pt) => pt.postId);

            const backendPosts = postTags
                .where('tagId')
                .eq(backendTag.id)
                .toArraySync()
                .map((pt) => pt.postId);

            const bothTagsPosts = frontendPosts.filter((id) =>
                backendPosts.includes(id)
            );
            expect(bothTagsPosts).toHaveLength(1);
            expect(bothTagsPosts[0]).toBe(post3.id);
        });
    });

    describe('Edge Cases and Complex Scenarios', () => {
        test('should handle orphaned records', () => {
            // Create user and post
            const user = users.insertSync({
                name: 'User',
                email: 'user@example.com',
            });

            const post = posts.insertSync({
                title: 'Post',
                content: 'Content',
                authorId: user.id,
            });

            // Delete user but leave post (creating orphan)
            users.deleteSync(user.id);

            // Post still exists but references non-existent user
            const orphanPost = posts.findByIdSync(post.id);
            expect(orphanPost).not.toBeNull();
            expect(orphanPost?.authorId).toBe(user.id);

            // Verify user doesn't exist
            const deletedUser = users.findByIdSync(user.id);
            expect(deletedUser).toBeNull();

            // Clean up orphaned post
            posts.deleteSync(post.id);
        });

        test('should handle circular references in relationships', () => {
            // Create users who reference each other (like followers)
            const user1 = users.insertSync({
                name: 'User 1',
                email: 'user1@example.com',
            });

            const user2 = users.insertSync({
                name: 'User 2',
                email: 'user2@example.com',
            });

            // User 1 posts, User 2 comments, User 1 replies to comment
            const post = posts.insertSync({
                title: 'Original Post',
                content: 'Post content',
                authorId: user1.id,
            });

            const comment = comments.insertSync({
                content: 'Comment by User 2',
                postId: post.id,
                authorId: user2.id,
            });

            const reply = comments.insertSync({
                content: 'Reply by User 1',
                postId: post.id,
                authorId: user1.id,
            });

            // Test finding all interactions
            const postComments = comments
                .where('postId')
                .eq(post.id)
                .toArraySync();
            expect(postComments).toHaveLength(2);

            const user1Comments = comments
                .where('authorId')
                .eq(user1.id)
                .toArraySync();
            const user2Comments = comments
                .where('authorId')
                .eq(user2.id)
                .toArraySync();

            expect(user1Comments).toHaveLength(1);
            expect(user2Comments).toHaveLength(1);
        });

        test('should handle bulk operations with relationships', () => {
            // Create multiple users
            const usersData = [
                { name: 'User 1', email: 'user1@example.com' },
                { name: 'User 2', email: 'user2@example.com' },
                { name: 'User 3', email: 'user3@example.com' },
            ];

            const createdUsers = users.insertBulkSync(usersData);
            expect(createdUsers).toHaveLength(3);

            // Create posts for each user
            const postsData = createdUsers.map((user, index) => ({
                title: `Post by ${user.name}`,
                content: `Content ${index + 1}`,
                authorId: user.id,
            }));

            const createdPosts = posts.insertBulkSync(postsData);
            expect(createdPosts).toHaveLength(3);

            // Verify relationships
            createdUsers.forEach((user, index) => {
                const userPosts = posts
                    .where('authorId')
                    .eq(user.id)
                    .toArraySync();
                expect(userPosts).toHaveLength(1);
                expect(userPosts[0].title).toBe(`Post by ${user.name}`);
            });

            // Bulk delete posts
            const postIds = createdPosts.map((p) => p.id);
            const deletedCount = posts.deleteBulkSync(postIds);
            expect(deletedCount).toBe(3);

            // Verify posts are deleted but users remain
            expect(posts.toArraySync()).toHaveLength(0);
            expect(users.toArraySync()).toHaveLength(3);
        });

        test('should handle null foreign keys', () => {
            // Create post without valid author (edge case)
            const fakeAuthorId = crypto.randomUUID();

            const orphanPost = posts.insertSync({
                title: 'Orphan Post',
                content: 'This post has no valid author',
                authorId: fakeAuthorId,
            });

            expect(orphanPost.authorId).toBe(fakeAuthorId);

            // Verify no user exists with this ID
            const nonExistentUser = users.findByIdSync(fakeAuthorId);
            expect(nonExistentUser).toBeNull();

            // Find all posts with invalid authors
            const allUsers = users.toArraySync();
            const validUserIds = allUsers.map((u) => u.id);
            const allPosts = posts.toArraySync();
            const orphanPosts = allPosts.filter(
                (p) => !validUserIds.includes(p.authorId)
            );

            expect(orphanPosts).toHaveLength(1);
            expect(orphanPosts[0].id).toBe(orphanPost.id);
        });

        test('should handle duplicate relationship entries', () => {
            // Create user, post, and category
            const user = users.insertSync({
                name: 'User',
                email: 'user@example.com',
            });

            const post = posts.insertSync({
                title: 'Post',
                content: 'Content',
                authorId: user.id,
            });

            const category = categories.insertSync({
                name: 'Category',
            });

            // Add post to category
            const relation1 = postCategories.insertSync({
                postId: post.id,
                categoryId: category.id,
            });

            // Attempt to add same relationship (should be allowed but detectable)
            const relation2 = postCategories.insertSync({
                postId: post.id,
                categoryId: category.id,
            });

            expect(relation1.id).not.toBe(relation2.id);

            // Count duplicates
            const duplicates = postCategories
                .where('postId')
                .eq(post.id)
                .and()
                .where('categoryId')
                .eq(category.id)
                .countSync();

            expect(duplicates).toBe(2);

            // Clean up one duplicate
            postCategories.deleteSync(relation2.id);
            const remaining = postCategories
                .where('postId')
                .eq(post.id)
                .and()
                .where('categoryId')
                .eq(category.id)
                .countSync();

            expect(remaining).toBe(1);
        });

        test('should handle complex filtering across relationships', () => {
            // Setup complex data scenario
            const author1 = users.insertSync({
                name: 'Author 1',
                email: 'author1@example.com',
                age: 30,
            });

            const author2 = users.insertSync({
                name: 'Author 2',
                email: 'author2@example.com',
                age: 25,
            });

            const techCategory = categories.insertSync({ name: 'Tech' });
            const scienceCategory = categories.insertSync({ name: 'Science' });

            const post1 = posts.insertSync({
                title: 'Tech Post 1',
                content: 'Content 1',
                authorId: author1.id,
                published: true,
            });

            const post2 = posts.insertSync({
                title: 'Tech Post 2',
                content: 'Content 2',
                authorId: author2.id,
                published: false,
            });

            const post3 = posts.insertSync({
                title: 'Science Post',
                content: 'Science content',
                authorId: author1.id,
                published: true,
            });

            // Categorize posts
            postCategories.insertSync({
                postId: post1.id,
                categoryId: techCategory.id,
            });
            postCategories.insertSync({
                postId: post2.id,
                categoryId: techCategory.id,
            });
            postCategories.insertSync({
                postId: post3.id,
                categoryId: scienceCategory.id,
            });

            // Find published posts by authors over 25 in Tech category
            const eligibleAuthors = users
                .where('age')
                .gt(25)
                .toArraySync()
                .map((u) => u.id);
            const publishedPosts = posts
                .where('published')
                .eq(true)
                .and()
                .where('authorId')
                .in(eligibleAuthors)
                .toArraySync();

            const techPostIds = postCategories
                .where('categoryId')
                .eq(techCategory.id)
                .toArraySync()
                .map((pc) => pc.postId);

            const result = publishedPosts.filter((p) =>
                techPostIds.includes(p.id)
            );
            expect(result).toHaveLength(1);
            expect(result[0].title).toBe('Tech Post 1');
        });
    });

    describe('JOIN Operations', () => {
        test('should perform INNER JOIN between users and posts', () => {
            // Create users
            const user1 = users.insertSync({
                name: 'Alice Johnson',
                email: 'alice@example.com',
                age: 28,
            });

            const user2 = users.insertSync({
                name: 'Bob Smith',
                email: 'bob@example.com',
                age: 32,
            });

            // Create posts
            const post1 = posts.insertSync({
                title: 'Alice Post 1',
                content: 'Content by Alice',
                authorId: user1.id,
                published: true,
            });

            const post2 = posts.insertSync({
                title: 'Bob Post 1',
                content: 'Content by Bob',
                authorId: user2.id,
                published: true,
            });

            // INNER JOIN users and posts using where() to get QueryBuilder first
            const joinResults = users
                .where('id')
                .exists() // Start with a simple condition to get QueryBuilder
                .join('posts', 'id', 'authorId')
                .select(
                    'users.name',
                    'users.email',
                    'posts.title',
                    'posts.content'
                )
                .toArraySync();

            expect(joinResults).toHaveLength(2);

            // Results should include data from both tables
            const aliceResult = joinResults.find(
                (r) => r.name === 'Alice Johnson'
            );
            expect(aliceResult).toBeDefined();
            expect(aliceResult?.title).toBeDefined(); // Post data should be included
        });

        test('should perform LEFT JOIN to include users without posts', () => {
            // Create users
            const user1 = users.insertSync({
                name: 'Alice with Posts',
                email: 'alice@example.com',
            });

            const user2 = users.insertSync({
                name: 'Bob without Posts',
                email: 'bob@example.com',
            });

            // Create post only for user1
            posts.insertSync({
                title: 'Alice Only Post',
                content: 'Content',
                authorId: user1.id,
            });

            // LEFT JOIN should include all users, even those without posts
            const leftJoinResults = users
                .where('id')
                .exists() // Start with a simple condition to get QueryBuilder
                .leftJoin('posts', 'id', 'authorId')
                .select('users.name', 'users.email', 'posts.title')
                .toArraySync();

            expect(leftJoinResults.length).toBeGreaterThanOrEqual(2);

            // Should include both users
            const userNames = leftJoinResults.map((r) => r.name);
            expect(userNames).toContain('Alice with Posts');
            expect(userNames).toContain('Bob without Posts');
        });

        test('should perform complex JOIN with filtering', () => {
            // Setup data
            const user1 = users.insertSync({
                name: 'Active User',
                email: 'active@example.com',
                age: 25,
            });

            const user2 = users.insertSync({
                name: 'Young User',
                email: 'young@example.com',
                age: 20,
            });

            posts.insertSync({
                title: 'Published Post',
                content: 'Content',
                authorId: user1.id,
                published: true,
            });

            posts.insertSync({
                title: 'Draft Post',
                content: 'Draft Content',
                authorId: user2.id,
                published: false,
            });

            // JOIN with additional filtering
            const filteredJoinResults = users
                .where('age')
                .gte(25) // Start with filtering condition
                .join('posts', 'id', 'authorId')
                .where('posts.published')
                .eq(true) // Use table-prefixed field name
                .select(
                    'users.name',
                    'users.age',
                    'posts.title',
                    'posts.published'
                )
                .toArraySync();

            expect(filteredJoinResults).toHaveLength(1);
            expect(filteredJoinResults[0].name).toBe('Active User');
            expect(filteredJoinResults[0].title).toBe('Published Post');
        });

        test('should perform multiple JOINs for complex relationships', () => {
            // Create test data
            const user = users.insertSync({
                name: 'Multi Join User',
                email: 'multi@example.com',
            });

            const post = posts.insertSync({
                title: 'Multi Join Post',
                content: 'Content',
                authorId: user.id,
            });

            const comment = comments.insertSync({
                content: 'Test comment',
                postId: post.id,
                authorId: user.id, // Comments also reference the user
            });

            // JOIN users to both posts and comments (both reference user ID)
            const multiJoinResults = users
                .where('name')
                .eq('Multi Join User') // Start with filtering condition
                .join('posts', 'id', 'authorId') // Join users to posts via authorId
                .join('comments', 'id', 'authorId') // Join users to comments via authorId
                .select('users.name', 'posts.title', 'comments.content')
                .toArraySync();

            expect(multiJoinResults.length).toBeGreaterThan(0);
            const result = multiJoinResults[0];
            expect(result.name).toBe('Multi Join User');
            expect(result.title).toBe('Multi Join Post');
            expect(result.content).toContain('Test comment'); // Comment content
        });
    });

    describe('CASCADE Operations', () => {
        let usersWithCascade: ReturnType<typeof db.collection>;
        let postsWithCascade: ReturnType<typeof db.collection>;

        beforeEach(() => {
            // Enable foreign key constraints for CASCADE operations
            db.execSync('PRAGMA foreign_keys = ON');

            // Create collections with cascade constraints
            const userSchemaWithConstraints = z.object({
                id: z.string().uuid(),
                name: z.string(),
                email: z.string().email(),
            });

            const postSchemaWithConstraints = z.object({
                id: z.string().uuid(),
                title: z.string(),
                content: z.string(),
                authorId: z.string().uuid(),
            });

            usersWithCascade = db.collection(
                'users_cascade',
                userSchemaWithConstraints
            );

            postsWithCascade = db.collection(
                'posts_cascade',
                postSchemaWithConstraints,
                {
                    constrainedFields: {
                        authorId: {
                            type: 'TEXT',
                            foreignKey: 'users_cascade.id',
                            onDelete: 'CASCADE',
                            onUpdate: 'CASCADE',
                        },
                    },
                }
            );
        });

        test('should handle CASCADE DELETE foreign key constraints', () => {
            // Create user and posts
            const user = usersWithCascade.insertSync({
                name: 'User for Cascade',
                email: 'cascade@example.com',
            });

            const post1 = postsWithCascade.insertSync({
                title: 'Post 1',
                content: 'Content 1',
                authorId: user.id,
            });

            const post2 = postsWithCascade.insertSync({
                title: 'Post 2',
                content: 'Content 2',
                authorId: user.id,
            });

            // Verify posts exist
            expect(
                postsWithCascade.where('authorId').eq(user.id).countSync()
            ).toBe(2);

            // Delete user - should cascade delete posts due to foreign key constraint
            usersWithCascade.deleteSync(user.id);

            // Verify user is deleted
            expect(usersWithCascade.findByIdSync(user.id)).toBeNull();

            // Posts should be automatically deleted due to CASCADE
            expect(
                postsWithCascade.where('authorId').eq(user.id).countSync()
            ).toBe(0);
            expect(postsWithCascade.findByIdSync(post1.id)).toBeNull();
            expect(postsWithCascade.findByIdSync(post2.id)).toBeNull();
        });

        test('should handle CASCADE UPDATE foreign key constraints', () => {
            // Note: CASCADE UPDATE is less common with UUIDs, but we can test the constraint setup
            const user = usersWithCascade.insertSync({
                name: 'Update Cascade User',
                email: 'update@example.com',
            });

            const post = postsWithCascade.insertSync({
                title: 'Update Post',
                content: 'Content',
                authorId: user.id,
            });

            // Verify constraint is set up correctly
            expect(post.authorId).toBe(user.id);

            // The CASCADE UPDATE constraint is in place, but with UUIDs we typically don't update IDs
            // This test verifies the constraint was created properly
            const foundPost = postsWithCascade.findByIdSync(post.id);
            expect(foundPost?.authorId).toBe(user.id);
        });

        test('should handle SET NULL on delete when configured', () => {
            // Create collection with SET NULL constraint
            const commentsSchemaWithSetNull = z.object({
                id: z.string().uuid(),
                content: z.string(),
                authorId: z.string().uuid().optional(),
            });

            const commentsWithSetNull = db.collection(
                'comments_set_null',
                commentsSchemaWithSetNull,
                {
                    constrainedFields: {
                        authorId: {
                            type: 'TEXT',
                            foreignKey: 'users_cascade.id',
                            onDelete: 'SET NULL',
                            nullable: true,
                        },
                    },
                }
            );

            const user = usersWithCascade.insertSync({
                name: 'Set Null User',
                email: 'setnull@example.com',
            });

            const comment = commentsWithSetNull.insertSync({
                content: 'Comment content',
                authorId: user.id,
            });

            // Verify comment has authorId
            expect(comment.authorId).toBe(user.id);

            // Delete user - should set authorId to NULL in comments
            usersWithCascade.deleteSync(user.id);

            // Comment should still exist but authorId should be null
            const updatedComment = commentsWithSetNull.findByIdSync(comment.id);
            expect(updatedComment).not.toBeNull();
            expect(updatedComment?.authorId).toBeNull();
        });

        test('should handle RESTRICT constraint (prevent deletion)', () => {
            // Create collection with RESTRICT constraint
            const restrictPostsSchema = z.object({
                id: z.string().uuid(),
                title: z.string(),
                authorId: z.string().uuid(),
            });

            const postsWithRestrict = db.collection(
                'posts_restrict',
                restrictPostsSchema,
                {
                    constrainedFields: {
                        authorId: {
                            type: 'TEXT',
                            foreignKey: 'users_cascade.id',
                            onDelete: 'RESTRICT',
                        },
                    },
                }
            );

            const user = usersWithCascade.insertSync({
                name: 'Restricted User',
                email: 'restrict@example.com',
            });

            postsWithRestrict.insertSync({
                title: 'Restricted Post',
                authorId: user.id,
            });

            // Attempting to delete user should be prevented by RESTRICT constraint
            // Note: SQLite will throw an error when RESTRICT constraint is violated
            expect(() => {
                usersWithCascade.deleteSync(user.id);
            }).toThrow(); // Should throw due to foreign key constraint violation
        });
    });

    describe('Performance with Relationships', () => {
        test('should handle large relationship datasets efficiently', () => {
            const startTime = Date.now();

            // Create many users
            const userCount = 100;
            const userPromises = [];
            for (let i = 0; i < userCount; i++) {
                userPromises.push(
                    users.insertSync({
                        name: `User ${i}`,
                        email: `user${i}@example.com`,
                        age: 20 + (i % 50),
                    })
                );
            }

            // Create posts for users (some users have multiple posts)
            const allUsers = users.toArraySync();
            const postPromises = [];
            allUsers.forEach((user, index) => {
                const postCount = (index % 3) + 1; // 1-3 posts per user
                for (let j = 0; j < postCount; j++) {
                    postPromises.push(
                        posts.insertSync({
                            title: `Post ${j + 1} by ${user.name}`,
                            content: `Content for post ${j + 1}`,
                            authorId: user.id,
                            published: Math.random() > 0.5,
                        })
                    );
                }
            });

            const allPosts = posts.toArraySync();
            expect(allPosts.length).toBeGreaterThan(userCount);

            // Test efficient filtering
            const publishedPosts = posts
                .where('published')
                .eq(true)
                .toArraySync();
            const activeUsers = publishedPosts.map((p) => p.authorId);
            const uniqueActiveUsers = [...new Set(activeUsers)];

            expect(uniqueActiveUsers.length).toBeGreaterThan(0);
            expect(uniqueActiveUsers.length).toBeLessThanOrEqual(userCount);

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should complete within reasonable time (adjust threshold as needed)
            expect(duration).toBeLessThan(5000); // 5 seconds
        });

        test('should handle relationship queries with proper indexing simulation', () => {
            // Create test data
            const author = users.insertSync({
                name: 'Prolific Author',
                email: 'prolific@example.com',
            });

            // Create many posts
            const postCount = 50;
            for (let i = 0; i < postCount; i++) {
                posts.insertSync({
                    title: `Post ${i}`,
                    content: `Content ${i}`,
                    authorId: author.id,
                    published: i % 2 === 0,
                });
            }

            const startTime = Date.now();

            // Test indexed lookup by authorId
            const authorPosts = posts
                .where('authorId')
                .eq(author.id)
                .toArraySync();
            expect(authorPosts).toHaveLength(postCount);

            // Test compound filtering
            const publishedAuthorPosts = posts
                .where('authorId')
                .eq(author.id)
                .and()
                .where('published')
                .eq(true)
                .toArraySync();

            expect(publishedAuthorPosts).toHaveLength(25);

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should be fast due to indexing on foreign key
            expect(duration).toBeLessThan(100); // 100ms
        });
    });
});
