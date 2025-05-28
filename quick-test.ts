import { z } from 'zod';
import { Database } from './src/database';

const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
    metadata: z.object({
        category: z.string(),
        priority: z.number(),
        more: z.object({
            tags: z.array(z.string()),
            createdAt: z.date(),
            updatedAt: z.date().optional(),
        }),
    }),
});

const db = new Database();
const users = db.collection('users', UserSchema);

// This should now provide autocomplete for 'id', 'name', 'metadata.category', 'metadata.priority'
const query = users.where('');

console.log('Autocomplete working!');
