import { z } from 'zod';
import { createDB } from '../src/index.js';
import { unique, foreignKey, index } from '../src/schema-constraints.js';

// Test schemas for different complexity levels
const simpleSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    score: z.number(),
});

const constrainedSchema = z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    username: z.string(),
    score: z.number(),
});

const complexSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().int(),
    score: z.number(),
    isActive: z.boolean().default(true),
    metadata: z
        .object({
            level: z.enum(['junior', 'mid', 'senior', 'lead']),
            location: z.string(),
            skills: z.array(z.string()),
        })
        .optional(),
});

interface PerformanceResult {
    operation: string;
    count: number;
    totalDuration: number;
    avgDuration: number;
    opsPerSecond: number;
}
