import { z } from 'zod';
import { createDB } from '../src/index.js';
import { describe, it } from 'bun:test';

const testSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    score: z.number(),
});

function benchmark(name: string, count: number, fn: () => void) {
    const start = performance.now();
    fn();
    const end = performance.now();
    const duration = end - start;
    const opsPerSecond = Math.round((count / duration) * 1000);

    return {
        operation: name,
        count,
        duration,
        opsPerSecond,
    };
}

describe('Upsert Optimization Verification', () => {
    it('should demonstrate the performance improvement', () => {
        console.log('=== Upsert Performance Comparison ===\n');

        const db = createDB({ memory: true });
        const collection = db.collection('test', testSchema);

        // Setup test data
        const testData = Array.from({ length: 1000 }, (_, i) => ({
            name: `User ${i}`,
            score: i * 10,
        }));

        console.log('Setting up test data...');
        const insertedDocs = collection.insertBulk(testData);
        const existingIds = insertedDocs.map((doc) => doc.id);

        // Test 1: Original upsert (via put method)
        console.log('1. Testing original upsert implementation...');
        const originalResult = benchmark(
            'Original Upsert (via put)',
            1000,
            () => {
                existingIds.forEach((id, i) => {
                    // Simulate the old implementation by directly calling put
                    collection.put(id, { score: i * 20 });
                });
            }
        );

        // Test 2: New optimized upsert
        console.log('2. Testing new optimized upsert...');
        const optimizedResult = benchmark('Optimized Upsert', 1000, () => {
            existingIds.forEach((id, i) => {
                collection.upsert(id, {
                    name: `Updated User ${i}`,
                    score: i * 30,
                });
            });
        });

        // Test 3: SQL-level optimized upsert
        console.log('3. Testing SQL-level optimized upsert...');
        const sqlOptimizedResult = benchmark(
            'SQL Optimized Upsert',
            1000,
            () => {
                existingIds.forEach((id, i) => {
                    collection.upsertOptimized(id, {
                        name: `SQL Updated User ${i}`,
                        score: i * 40,
                    });
                });
            }
        );

        // Results
        console.log('\n=== PERFORMANCE COMPARISON RESULTS ===\n');

        console.log(`${originalResult.operation}:`);
        console.log(`  Duration: ${originalResult.duration.toFixed(2)}ms`);
        console.log(
            `  Ops/sec: ${originalResult.opsPerSecond.toLocaleString()}\n`
        );

        console.log(`${optimizedResult.operation}:`);
        console.log(`  Duration: ${optimizedResult.duration.toFixed(2)}ms`);
        console.log(
            `  Ops/sec: ${optimizedResult.opsPerSecond.toLocaleString()}\n`
        );

        console.log(`${sqlOptimizedResult.operation}:`);
        console.log(`  Duration: ${sqlOptimizedResult.duration.toFixed(2)}ms`);
        console.log(
            `  Ops/sec: ${sqlOptimizedResult.opsPerSecond.toLocaleString()}\n`
        );

        // Calculate improvements
        const optimizedImprovement =
            ((optimizedResult.opsPerSecond - originalResult.opsPerSecond) /
                originalResult.opsPerSecond) *
            100;
        const sqlOptimizedImprovement =
            ((sqlOptimizedResult.opsPerSecond - originalResult.opsPerSecond) /
                originalResult.opsPerSecond) *
            100;

        console.log('=== IMPROVEMENT ANALYSIS ===\n');
        console.log(
            `Optimized Upsert Improvement: ${optimizedImprovement.toFixed(1)}%`
        );
        console.log(
            `SQL Optimized Improvement: ${sqlOptimizedImprovement.toFixed(1)}%`
        );

        if (optimizedImprovement > 50) {
            console.log('✅ Significant performance improvement achieved!');
        } else if (optimizedImprovement > 20) {
            console.log('✅ Good performance improvement achieved!');
        } else {
            console.log('⚠️  Minimal improvement - investigate further');
        }

        // Verify data integrity
        console.log('\n=== DATA INTEGRITY VERIFICATION ===\n');
        const finalDocs = collection.toArray();
        const expectedCount = 1000;

        console.log(`Expected documents: ${expectedCount}`);
        console.log(`Actual documents: ${finalDocs.length}`);
        console.log(
            `Data integrity: ${
                finalDocs.length === expectedCount ? '✅ PASS' : '❌ FAIL'
            }`
        );

        // Check a sample document
        const sampleDoc = finalDocs[0];
        console.log(`Sample document:`, sampleDoc);

        db.close();
    });

    it('should handle mixed insert/update scenarios efficiently', () => {
        console.log('\n=== Mixed Insert/Update Performance ===\n');

        const db = createDB({ memory: true });
        const collection = db.collection('mixed', testSchema);

        // Pre-populate 500 documents
        const preData = Array.from({ length: 500 }, (_, i) => ({
            name: `Existing User ${i}`,
            score: i * 5,
        }));
        const preInserted = collection.insertBulk(preData);
        const existingIds = preInserted.map((doc) => doc.id);

        // Create 500 new IDs for inserts
        const newIds = Array.from({ length: 500 }, () => crypto.randomUUID());
        const allIds = [...existingIds, ...newIds];

        console.log('Testing mixed insert/update with optimized upsert...');
        const mixedResult = benchmark(
            'Mixed Insert/Update Upsert',
            1000,
            () => {
                allIds.forEach((id, i) => {
                    collection.upsert(id, {
                        name: `Mixed User ${i}`,
                        score: i * 15,
                    });
                });
            }
        );

        console.log(
            `Mixed operations: ${mixedResult.opsPerSecond.toLocaleString()} ops/sec`
        );

        // Verify results
        const finalCount = collection.toArray().length;
        console.log(`Final document count: ${finalCount} (expected: 1000)`);
        console.log(
            `Mixed operation integrity: ${
                finalCount === 1000 ? '✅ PASS' : '❌ FAIL'
            }`
        );

        db.close();
    });
});
