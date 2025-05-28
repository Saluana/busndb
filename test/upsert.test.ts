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

async function analyzeUpsertPerformance() {
    console.log('=== Upsert Performance Analysis ===\n');

    const db = createDB({ memory: true });
    const results: PerformanceResult[] = [];

    // Test 1: Simple upserts (50% insert, 50% update)
    console.log('1. Testing simple upserts (50% insert, 50% update)...');
    const simpleCollection = db.collection('simple', simpleSchema);

    // Pre-populate with 500 documents
    const preData = Array.from({ length: 500 }, (_, i) => ({
        name: `User ${i}`,
        score: Math.random() * 1000,
    }));
    const preInserted = simpleCollection.insertBulk(preData);
    const existingIds = preInserted.map((doc) => doc.id);

    // Generate test data: 500 existing IDs (updates) + 500 new IDs (inserts)
    const newIds = Array.from({ length: 500 }, () => crypto.randomUUID());
    const allIds = [...existingIds, ...newIds];

    const simpleUpsertResult = benchmark(
        'Simple Upserts (Mixed Insert/Update)',
        1000,
        () => {
            allIds.forEach((id, i) => {
                simpleCollection.upsert(id, {
                    name: `Updated User ${i}`,
                    score: i * 10,
                });
            });
        }
    );
    results.push(simpleUpsertResult);

    // Test 2: Simple upsert bulk operations
    console.log('2. Testing simple upsert bulk operations...');
    const bulkUpsertData = allIds.map((id, i) => ({
        id,
        doc: {
            name: `Bulk Updated User ${i}`,
            score: i * 15,
        },
    }));

    const simpleUpsertBulkResult = benchmark('Simple Upsert Bulk', 1000, () => {
        simpleCollection.upsertBulk(bulkUpsertData);
    });
    results.push(simpleUpsertBulkResult);

    // Test 3: Upserts with unique constraints
    console.log('3. Testing upserts with unique constraints...');
    const constrainedCollection = db.collection(
        'constrained',
        constrainedSchema,
        {
            constraints: {
                constraints: {
                    email: unique(),
                    username: unique(),
                },
            },
        }
    );

    // Pre-populate with 500 documents
    const constrainedPreData = Array.from({ length: 500 }, (_, i) => ({
        email: `user${i}@example.com`,
        username: `user${i}`,
        score: Math.random() * 1000,
    }));
    const constrainedPreInserted =
        constrainedCollection.insertBulk(constrainedPreData);
    const constrainedExistingIds = constrainedPreInserted.map((doc) => doc.id);

    // Generate new IDs for inserts
    const constrainedNewIds = Array.from({ length: 500 }, () =>
        crypto.randomUUID()
    );
    const constrainedAllIds = [...constrainedExistingIds, ...constrainedNewIds];

    const constrainedUpsertResult = benchmark(
        'Upserts with Unique Constraints',
        1000,
        () => {
            constrainedAllIds.forEach((id, i) => {
                constrainedCollection.upsert(id, {
                    email: `updated${i}@example.com`,
                    username: `updated_user${i}`,
                    score: i * 10,
                });
            });
        }
    );
    results.push(constrainedUpsertResult);

    // Test 4: Complex schema upserts
    console.log('4. Testing complex schema upserts...');
    const complexCollection = db.collection('complex', complexSchema, {
        constraints: {
            constraints: {
                email: unique(),
            },
            indexes: {
                email: index('email'),
                age: index('age'),
                level: index(['metadata', 'level'].join('.')),
            },
        },
    });

    // Pre-populate with 500 documents
    const complexPreData = Array.from({ length: 500 }, (_, i) => ({
        name: `User ${i}`,
        email: `user${i}@example.com`,
        age: 25 + (i % 40),
        score: Math.random() * 1000,
        isActive: i % 2 === 0,
        metadata:
            i % 3 !== 0
                ? {
                      level: (['junior', 'mid', 'senior', 'lead'] as const)[
                          i % 4
                      ],
                      location: `City ${i % 10}`,
                      skills: [`skill${i % 5}`, `skill${(i + 1) % 5}`],
                  }
                : undefined,
    }));
    const complexPreInserted = complexCollection.insertBulk(complexPreData);
    const complexExistingIds = complexPreInserted.map((doc) => doc.id);

    const complexNewIds = Array.from({ length: 500 }, () =>
        crypto.randomUUID()
    );
    const complexAllIds = [...complexExistingIds, ...complexNewIds];

    const complexUpsertResult = benchmark(
        'Complex Schema Upserts',
        1000,
        () => {
            complexAllIds.forEach((id, i) => {
                complexCollection.upsert(id, {
                    name: `Updated User ${i}`,
                    email: `updated${i}@example.com`,
                    age: 25 + ((i + 10) % 40),
                    score: i * 10,
                    isActive: i % 3 === 0,
                    metadata:
                        i % 2 !== 0
                            ? {
                                  level: (
                                      [
                                          'junior',
                                          'mid',
                                          'senior',
                                          'lead',
                                      ] as const
                                  )[(i + 1) % 4],
                                  location: `Updated City ${i % 10}`,
                                  skills: [
                                      `updated_skill${i % 5}`,
                                      `updated_skill${(i + 1) % 5}`,
                                  ],
                              }
                            : undefined,
                });
            });
        }
    );
    results.push(complexUpsertResult);

    // Test 5: Pure inserts vs pure updates comparison
    console.log('5. Testing pure inserts vs pure updates...');

    const pureInsertResult = benchmark('Pure Inserts via Upsert', 500, () => {
        Array.from({ length: 500 }, () => {
            const id = crypto.randomUUID();
            simpleCollection.upsert(id, {
                name: `New User`,
                score: Math.random() * 1000,
            });
        });
    });
    results.push(pureInsertResult);

    const existingDocsForUpdate = simpleCollection.toArray().slice(0, 500);
    const pureUpdateResult = benchmark('Pure Updates via Upsert', 500, () => {
        existingDocsForUpdate.forEach((doc, i) => {
            simpleCollection.upsert(doc.id, {
                name: `Updated ${doc.name}`,
                score: i * 20,
            });
        });
    });
    results.push(pureUpdateResult);

    // Test 6: Compare upsert vs separate insert/put operations
    console.log('6. Comparing upsert vs separate insert/put...');

    const separateOpsResult = benchmark(
        'Separate Insert/Put Operations',
        1000,
        () => {
            allIds.forEach((id, i) => {
                const existing = simpleCollection.findById(id);
                if (existing) {
                    simpleCollection.put(id, {
                        name: `Separate Update ${i}`,
                        score: i * 25,
                    });
                } else {
                    simpleCollection.insert({
                        name: `Separate Insert ${i}`,
                        score: i * 25,
                    });
                }
            });
        }
    );
    results.push(separateOpsResult);

    // Test 7: Upsert bulk vs individual upserts
    console.log('7. Comparing upsert bulk vs individual upserts...');

    const individualUpsertsResult = benchmark(
        'Individual Upserts',
        1000,
        () => {
            bulkUpsertData.forEach((item) => {
                simpleCollection.upsert(item.id, item.doc);
            });
        }
    );
    results.push(individualUpsertsResult);

    db.close();

    // Display results
    console.log('\n=== UPSERT PERFORMANCE ANALYSIS RESULTS ===\n');

    results.forEach((result) => {
        console.log(`${result.operation}:`);
        console.log(`  Total Time:   ${result.totalDuration.toFixed(2)}ms`);
        console.log(`  Avg per Op:   ${result.avgDuration.toFixed(3)}ms`);
        console.log(`  Ops/sec:      ${result.opsPerSecond.toLocaleString()}`);
        console.log('');
    });

    // Analysis
    console.log('=== ANALYSIS ===\n');

    const simpleUpsertOps = results.find((r) =>
        r.operation.includes('Simple Upserts (Mixed')
    )?.opsPerSecond;
    const constrainedUpsertOps = results.find((r) =>
        r.operation.includes('Unique Constraints')
    )?.opsPerSecond;
    const complexUpsertOps = results.find((r) =>
        r.operation.includes('Complex Schema')
    )?.opsPerSecond;
    const bulkUpsertOps = results.find((r) =>
        r.operation.includes('Upsert Bulk')
    )?.opsPerSecond;
    const individualUpsertOps = results.find((r) =>
        r.operation.includes('Individual Upserts')
    )?.opsPerSecond;
    const pureInsertOps = results.find((r) =>
        r.operation.includes('Pure Inserts')
    )?.opsPerSecond;
    const pureUpdateOps = results.find((r) =>
        r.operation.includes('Pure Updates')
    )?.opsPerSecond;
    const separateOpsOps = results.find((r) =>
        r.operation.includes('Separate Insert/Put')
    )?.opsPerSecond;

    let constraintOverhead = 0;
    let complexityOverhead = 0;
    let bulkEfficiency = 0;
    let upsertVsSeparateEfficiency = 0;

    if (simpleUpsertOps && constrainedUpsertOps) {
        constraintOverhead =
            ((simpleUpsertOps - constrainedUpsertOps) / simpleUpsertOps) * 100;
        console.log(
            `Constraint Validation Overhead: ${constraintOverhead.toFixed(1)}%`
        );
    }

    if (simpleUpsertOps && complexUpsertOps) {
        complexityOverhead =
            ((simpleUpsertOps - complexUpsertOps) / simpleUpsertOps) * 100;
        console.log(
            `Schema Complexity Overhead: ${complexityOverhead.toFixed(1)}%`
        );
    }

    if (bulkUpsertOps && individualUpsertOps) {
        bulkEfficiency =
            ((bulkUpsertOps - individualUpsertOps) / individualUpsertOps) * 100;
        console.log(
            `Bulk Upsert Efficiency Gain: ${bulkEfficiency.toFixed(1)}%`
        );
    }

    if (simpleUpsertOps && separateOpsOps) {
        upsertVsSeparateEfficiency =
            ((simpleUpsertOps - separateOpsOps) / separateOpsOps) * 100;
        console.log(
            `Upsert vs Separate Ops Efficiency: ${upsertVsSeparateEfficiency.toFixed(
                1
            )}%`
        );
    }

    console.log(`\nOperation Breakdown:`);
    console.log(
        `  Simple Upserts (Mixed): ${simpleUpsertOps?.toLocaleString()} ops/sec`
    );
    console.log(
        `  Pure Inserts via Upsert: ${pureInsertOps?.toLocaleString()} ops/sec`
    );
    console.log(
        `  Pure Updates via Upsert: ${pureUpdateOps?.toLocaleString()} ops/sec`
    );
    console.log(`  Upsert Bulk: ${bulkUpsertOps?.toLocaleString()} ops/sec`);
    console.log(
        `  Individual Upserts: ${individualUpsertOps?.toLocaleString()} ops/sec`
    );
    console.log(
        `  Separate Insert/Put: ${separateOpsOps?.toLocaleString()} ops/sec`
    );

    // Recommendations
    console.log('\n=== RECOMMENDATIONS ===\n');

    if (pureInsertOps && pureUpdateOps) {
        const insertUpdateRatio = pureUpdateOps / pureInsertOps;
        if (insertUpdateRatio > 1.5) {
            console.log(
                '✅ Updates via upsert are significantly faster than inserts - good optimization'
            );
        } else if (insertUpdateRatio < 0.7) {
            console.log(
                '⚠️  Inserts via upsert are much faster than updates - investigate findById overhead'
            );
        } else {
            console.log(
                '✅ Insert/Update performance via upsert is well balanced'
            );
        }
    }

    if (bulkEfficiency && bulkEfficiency > 20) {
        console.log(
            '✅ Bulk upsert provides significant performance benefit - use for large datasets'
        );
    } else if (bulkEfficiency < 0) {
        console.log(
            '⚠️  Individual upserts are faster than bulk - investigate bulk overhead'
        );
    } else {
        console.log('📊 Bulk upsert provides modest performance benefit');
    }

    if (upsertVsSeparateEfficiency && upsertVsSeparateEfficiency > 10) {
        console.log(
            '✅ Upsert is more efficient than separate insert/put operations'
        );
    } else if (upsertVsSeparateEfficiency < -10) {
        console.log(
            '⚠️  Separate insert/put operations are more efficient than upsert - investigate findById overhead'
        );
    } else {
        console.log(
            '📊 Upsert and separate operations have similar performance'
        );
    }

    if (constraintOverhead && constraintOverhead > 50) {
        console.log(
            '⚠️  High constraint validation overhead in upserts - consider optimization'
        );
    } else {
        console.log(
            '✅ Constraint validation overhead in upserts is reasonable'
        );
    }

    if (complexityOverhead && complexityOverhead > 60) {
        console.log(
            '⚠️  High schema complexity overhead in upserts - consider simplification'
        );
    } else {
        console.log('✅ Schema complexity overhead in upserts is manageable');
    }
}

// Test structure for running the analysis
import { describe, it } from 'bun:test';

describe('Upsert Performance Analysis', () => {
    it('should analyze upsert performance characteristics', async () => {
        await analyzeUpsertPerformance();
    }, 30000); // 30 second timeout

    it('should test basic upsert functionality', () => {
        const db = createDB({ memory: true });
        const collection = db.collection('test', simpleSchema);

        // Test insert via upsert
        const id = crypto.randomUUID();
        const result1 = collection.upsert(id, {
            name: 'Test User',
            score: 100,
        });

        console.log('Insert via upsert result:', result1);
        console.log('Expected ID:', id);
        console.log('Actual ID:', result1.id);

        // Test update via upsert
        const result2 = collection.upsert(id, {
            name: 'Updated User',
            score: 200,
        });

        console.log('Update via upsert result:', result2);

        // Verify the document was updated
        const found = collection.findById(id);
        console.log('Found document:', found);

        db.close();
    });

    it('should test bulk upsert functionality', () => {
        const db = createDB({ memory: true });
        const collection = db.collection('test', simpleSchema);

        const testData = [
            { id: crypto.randomUUID(), doc: { name: 'User 1', score: 100 } },
            { id: crypto.randomUUID(), doc: { name: 'User 2', score: 200 } },
            { id: crypto.randomUUID(), doc: { name: 'User 3', score: 300 } },
        ];

        // First upsert (all inserts)
        const results1 = collection.upsertBulk(testData);
        console.log('Bulk upsert results (inserts):', results1.length);

        // Update the data and upsert again (all updates)
        const updatedData = testData.map((item) => ({
            ...item,
            doc: { ...item.doc, score: item.doc.score * 2 },
        }));

        const results2 = collection.upsertBulk(updatedData);
        console.log('Bulk upsert results (updates):', results2.length);

        // Verify all documents exist with updated scores
        const allDocs = collection.toArray();
        console.log('All documents after bulk upsert:', allDocs);

        db.close();
    });
});
