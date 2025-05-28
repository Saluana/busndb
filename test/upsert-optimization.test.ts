import { z } from 'zod';
import { createDB } from '../src/index.js';
import { describe, it } from 'bun:test';

const testSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    score: z.number(),
    data: z
        .object({
            level: z.number(),
            tags: z.array(z.string()),
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

function benchmark(
    name: string,
    count: number,
    fn: () => void
): PerformanceResult {
    const start = performance.now();
    fn();
    const end = performance.now();
    const duration = end - start;
    const opsPerSecond = Math.round((count / duration) * 1000);
    const avgDuration = duration / count;

    return {
        operation: name,
        count,
        totalDuration: duration,
        avgDuration,
        opsPerSecond,
    };
}

describe('Upsert Optimization Analysis', () => {
    it('should identify findById overhead and optimization opportunities', () => {
        console.log('=== Upsert Optimization Analysis ===\n');

        const db = createDB({ memory: true });
        const collection = db.collection('test', testSchema);
        const results: PerformanceResult[] = [];

        // Setup: Create 1000 test documents
        const testData = Array.from({ length: 1000 }, (_, i) => ({
            name: `User ${i}`,
            score: i * 10,
            data:
                i % 2 === 0
                    ? {
                          level: i % 5,
                          tags: [`tag${i % 3}`, `tag${(i + 1) % 3}`],
                      }
                    : undefined,
        }));

        console.log('Setting up test data...');
        const insertedDocs = collection.insertBulk(testData);
        const existingIds = insertedDocs.map((doc) => doc.id);

        // Test 1: Measure just findById operations
        console.log('1. Measuring findById operations...');
        const findByIdResult = benchmark('FindById Operations', 1000, () => {
            existingIds.forEach((id) => {
                collection.findById(id);
            });
        });
        results.push(findByIdResult);

        // Test 2: Measure put operations (includes findById + merge + update)
        console.log('2. Measuring put operations...');
        const putResult = benchmark('Put Operations', 1000, () => {
            existingIds.forEach((id, i) => {
                collection.put(id, { score: i * 20 });
            });
        });
        results.push(putResult);

        // Test 3: Measure current upsert update path
        console.log('3. Measuring current upsert updates...');
        const currentUpsertResult = benchmark(
            'Current Upsert Updates',
            1000,
            () => {
                existingIds.forEach((id, i) => {
                    collection.upsert(id, {
                        name: `Updated User ${i}`,
                        score: i * 30,
                    });
                });
            }
        );
        results.push(currentUpsertResult);

        // Test 4: Measure direct SQL updates for comparison
        console.log('4. Measuring direct SQL updates...');
        const directSqlResult = benchmark('Direct SQL Updates', 1000, () => {
            existingIds.forEach((id, i) => {
                const sql = `UPDATE test SET doc = json_set(doc, '$.score', ?) WHERE _id = ?`;
                collection['driver'].exec(sql, [i * 40, id]);
            });
        });
        results.push(directSqlResult);

        // Test 5: Measure optimized upsert (simulate what it could be)
        console.log('5. Measuring simulated optimized upsert...');
        const optimizedUpsertResult = benchmark(
            'Simulated Optimized Upsert',
            1000,
            () => {
                existingIds.forEach((id, i) => {
                    // Simulate: single query that does upsert at SQL level
                    // For now, just measure the overhead of checking existence
                    const exists =
                        collection['driver'].query(
                            'SELECT 1 FROM test WHERE _id = ? LIMIT 1',
                            [id]
                        ).length > 0;

                    if (exists) {
                        // Direct update without findById
                        const sql = `UPDATE test SET doc = json_set(doc, '$.score', ?) WHERE _id = ?`;
                        collection['driver'].exec(sql, [i * 50, id]);
                    } else {
                        // This shouldn't happen in this test, but would be insert
                    }
                });
            }
        );
        results.push(optimizedUpsertResult);

        // Test 6: Component timing breakdown
        console.log('6. Breaking down upsert update components...');

        // Time just the existence check
        const existenceCheckResult = benchmark(
            'Existence Check Only',
            1000,
            () => {
                existingIds.forEach((id) => {
                    collection['driver'].query(
                        'SELECT 1 FROM test WHERE _id = ? LIMIT 1',
                        [id]
                    ).length > 0;
                });
            }
        );
        results.push(existenceCheckResult);

        // Time just the document retrieval and parsing
        const docRetrievalResult = benchmark(
            'Document Retrieval + Parse',
            1000,
            () => {
                existingIds.forEach((id) => {
                    const rows = collection['driver'].query(
                        'SELECT doc FROM test WHERE _id = ?',
                        [id]
                    );
                    if (rows.length > 0) {
                        JSON.parse(rows[0].doc);
                    }
                });
            }
        );
        results.push(docRetrievalResult);

        // Time just the object merging
        const docs = existingIds.map((id) => collection.findById(id)!);
        const objectMergeResult = benchmark(
            'Object Merge Operations',
            1000,
            () => {
                docs.forEach((doc, i) => {
                    const merged = { ...doc, score: i * 60 };
                    // Simulate validation
                    testSchema.parse(merged);
                });
            }
        );
        results.push(objectMergeResult);

        db.close();

        // Display results
        console.log('\n=== OPTIMIZATION ANALYSIS RESULTS ===\n');

        results.forEach((result) => {
            console.log(`${result.operation}:`);
            console.log(`  Total Time:   ${result.totalDuration.toFixed(2)}ms`);
            console.log(`  Avg per Op:   ${result.avgDuration.toFixed(3)}ms`);
            console.log(
                `  Ops/sec:      ${result.opsPerSecond.toLocaleString()}`
            );
            console.log('');
        });

        // Analysis
        console.log('=== BOTTLENECK ANALYSIS ===\n');

        const findByIdOps =
            results.find((r) => r.operation.includes('FindById Operations'))
                ?.opsPerSecond || 0;
        const putOps =
            results.find((r) => r.operation.includes('Put Operations'))
                ?.opsPerSecond || 0;
        const currentUpsertOps =
            results.find((r) => r.operation.includes('Current Upsert'))
                ?.opsPerSecond || 0;
        const directSqlOps =
            results.find((r) => r.operation.includes('Direct SQL'))
                ?.opsPerSecond || 0;
        const optimizedUpsertOps =
            results.find((r) => r.operation.includes('Optimized Upsert'))
                ?.opsPerSecond || 0;
        const existenceCheckOps =
            results.find((r) => r.operation.includes('Existence Check'))
                ?.opsPerSecond || 0;
        const docRetrievalOps =
            results.find((r) => r.operation.includes('Document Retrieval'))
                ?.opsPerSecond || 0;
        const objectMergeOps =
            results.find((r) => r.operation.includes('Object Merge'))
                ?.opsPerSecond || 0;

        console.log('Component Performance:');
        console.log(
            `  Existence Check Only: ${existenceCheckOps.toLocaleString()} ops/sec`
        );
        console.log(
            `  Document Retrieval + Parse: ${docRetrievalOps.toLocaleString()} ops/sec`
        );
        console.log(
            `  Object Merge + Validation: ${objectMergeOps.toLocaleString()} ops/sec`
        );
        console.log(
            `  FindById (full): ${findByIdOps.toLocaleString()} ops/sec`
        );
        console.log(
            `  Direct SQL Update: ${directSqlOps.toLocaleString()} ops/sec`
        );
        console.log('');

        console.log('Operation Performance:');
        console.log(
            `  Current Upsert Updates: ${currentUpsertOps.toLocaleString()} ops/sec`
        );
        console.log(`  Put Operations: ${putOps.toLocaleString()} ops/sec`);
        console.log(
            `  Simulated Optimized Upsert: ${optimizedUpsertOps.toLocaleString()} ops/sec`
        );
        console.log('');

        // Calculate overhead percentages
        const findByIdOverhead =
            directSqlOps > 0
                ? ((directSqlOps - findByIdOps) / directSqlOps) * 100
                : 0;
        const putOverhead =
            directSqlOps > 0
                ? ((directSqlOps - putOps) / directSqlOps) * 100
                : 0;
        const upsertOverhead =
            directSqlOps > 0
                ? ((directSqlOps - currentUpsertOps) / directSqlOps) * 100
                : 0;
        const optimizationPotential =
            currentUpsertOps > 0
                ? ((optimizedUpsertOps - currentUpsertOps) / currentUpsertOps) *
                  100
                : 0;

        console.log('Overhead Analysis:');
        console.log(
            `  FindById vs Direct SQL: ${findByIdOverhead.toFixed(1)}% overhead`
        );
        console.log(`  Put vs Direct SQL: ${putOverhead.toFixed(1)}% overhead`);
        console.log(
            `  Current Upsert vs Direct SQL: ${upsertOverhead.toFixed(
                1
            )}% overhead`
        );
        console.log(
            `  Optimization Potential: ${optimizationPotential.toFixed(
                1
            )}% improvement possible`
        );
        console.log('');

        // Identify bottlenecks
        console.log('=== BOTTLENECK IDENTIFICATION ===\n');

        const slowestComponent = Math.min(
            existenceCheckOps,
            docRetrievalOps,
            objectMergeOps
        );

        if (slowestComponent === existenceCheckOps) {
            console.log(
                '🐌 BOTTLENECK: Existence check queries are the slowest component'
            );
            console.log(
                '   Recommendation: Add index on id field or use more efficient existence check'
            );
        } else if (slowestComponent === docRetrievalOps) {
            console.log(
                '🐌 BOTTLENECK: Document retrieval and JSON parsing is the slowest component'
            );
            console.log(
                '   Recommendation: Optimize JSON parsing or reduce document size'
            );
        } else if (slowestComponent === objectMergeOps) {
            console.log(
                '🐌 BOTTLENECK: Object merging and validation is the slowest component'
            );
            console.log(
                '   Recommendation: Optimize Zod validation or object spreading'
            );
        }

        if (findByIdOps > 0 && putOps > 0) {
            const doubleFindByIdImpact = findByIdOps > putOps * 2;
            if (doubleFindByIdImpact) {
                console.log(
                    '⚠️  ISSUE: Double findById calls detected in upsert->put chain'
                );
                console.log(
                    '   Impact: Significant performance loss from redundant queries'
                );
            }
        }

        if (optimizationPotential > 30) {
            console.log(
                `🚀 HIGH OPTIMIZATION POTENTIAL: ${optimizationPotential.toFixed(
                    1
                )}% improvement possible`
            );
            console.log('   Recommendation: Implement optimized upsert path');
        }

        console.log('\n=== RECOMMENDED OPTIMIZATIONS ===\n');
        console.log('1. Eliminate double findById calls in upsert->put chain');
        console.log('2. Use SQL-level UPSERT/INSERT OR REPLACE when possible');
        console.log('3. Cache document retrieval within same operation');
        console.log('4. Consider bulk update optimizations for upsertBulk');
        console.log('5. Add database indexes on frequently queried fields');
    });
});
