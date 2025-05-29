import { describe, test, expect, beforeEach } from 'bun:test';
import { BunDriver } from '../src/drivers/bun.js';
import type { DBConfig } from '../src/types.js';

describe('Bun Driver Performance Benchmark', () => {
    let bunDriver: BunDriver;
    
    const TEST_SIZE = 10000;
    const WARMUP_SIZE = 100;

    beforeEach(async () => {
        // Initialize Bun driver with optimized settings
        const bunConfig: DBConfig = {
            memory: true,
            driver: 'bun',
            sqlite: {
                journalMode: 'WAL',
                synchronous: 'NORMAL',
                busyTimeout: 5000,
                cacheSize: -64000, // 64MB
                tempStore: 'MEMORY',
                lockingMode: 'NORMAL',
                autoVacuum: 'NONE',
                walCheckpoint: 1000
            }
        };
        bunDriver = new BunDriver(bunConfig);

        // Setup test table
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS bun_benchmark_test (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                age INTEGER,
                score REAL,
                active BOOLEAN,
                metadata TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        `;

        await bunDriver.exec(createTableSQL);
        
        // Create indexes for better read performance
        await bunDriver.exec('CREATE INDEX IF NOT EXISTS idx_age ON bun_benchmark_test(age)');
        await bunDriver.exec('CREATE INDEX IF NOT EXISTS idx_score ON bun_benchmark_test(score)');
        await bunDriver.exec('CREATE INDEX IF NOT EXISTS idx_active ON bun_benchmark_test(active)');
    });

    async function warmupDriver() {
        // Warmup with small operations
        for (let i = 0; i < WARMUP_SIZE; i++) {
            await bunDriver.exec(
                'INSERT INTO bun_benchmark_test (name, email, age, score, active, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    `WarmupUser${i}`, 
                    `warmup${i}@test.com`, 
                    25 + (i % 50), 
                    Math.random() * 100, 
                    i % 2 === 0,
                    JSON.stringify({ test: true, index: i }),
                    new Date().toISOString(),
                    new Date().toISOString()
                ]
            );
        }
        await bunDriver.exec('DELETE FROM bun_benchmark_test');
    }

    function generateTestData(count: number) {
        return Array.from({ length: count }, (_, i) => ({
            name: `User${i}`,
            email: `user${i}@test.com`,
            age: 25 + (i % 50),
            score: Math.random() * 100,
            active: i % 2 === 0,
            metadata: JSON.stringify({ 
                preferences: { theme: i % 2 === 0 ? 'dark' : 'light' },
                tags: [`tag${i % 10}`, `category${i % 5}`],
                level: Math.floor(i / 100)
            }),
            created_at: new Date(Date.now() - Math.random() * 86400000).toISOString(),
            updated_at: new Date().toISOString()
        }));
    }

    async function benchmarkAsyncInserts() {
        const testData = generateTestData(TEST_SIZE);
        
        console.log(`\n=== Bun Async Insert Benchmark ===`);
        
        // Individual async inserts
        const insertStart = performance.now();
        for (const data of testData) {
            await bunDriver.exec(
                'INSERT INTO bun_benchmark_test (name, email, age, score, active, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [data.name, data.email, data.age, data.score, data.active, data.metadata, data.created_at, data.updated_at]
            );
        }
        const insertTime = performance.now() - insertStart;
        
        console.log(`Async Inserts: ${TEST_SIZE} operations in ${insertTime.toFixed(2)}ms`);
        console.log(`Avg per insert: ${(insertTime / TEST_SIZE).toFixed(4)}ms`);
        console.log(`Inserts/sec: ${Math.round(TEST_SIZE / (insertTime / 1000))}`);
        
        return {
            totalTime: insertTime,
            avgTime: insertTime / TEST_SIZE,
            opsPerSec: TEST_SIZE / (insertTime / 1000)
        };
    }

    async function benchmarkSyncInserts() {
        // Clear table and generate fresh test data
        await bunDriver.exec('DELETE FROM bun_benchmark_test');
        const testData = generateTestData(TEST_SIZE);
        
        console.log(`\n=== Bun Sync Insert Benchmark ===`);
        
        // Individual sync inserts
        const insertStart = performance.now();
        for (const data of testData) {
            bunDriver.execSync(
                'INSERT INTO bun_benchmark_test (name, email, age, score, active, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [data.name, data.email, data.age, data.score, data.active, data.metadata, data.created_at, data.updated_at]
            );
        }
        const insertTime = performance.now() - insertStart;
        
        console.log(`Sync Inserts: ${TEST_SIZE} operations in ${insertTime.toFixed(2)}ms`);
        console.log(`Avg per insert: ${(insertTime / TEST_SIZE).toFixed(4)}ms`);
        console.log(`Inserts/sec: ${Math.round(TEST_SIZE / (insertTime / 1000))}`);
        
        return {
            totalTime: insertTime,
            avgTime: insertTime / TEST_SIZE,
            opsPerSec: TEST_SIZE / (insertTime / 1000)
        };
    }

    async function benchmarkAsyncReads() {
        console.log(`\n=== Bun Async Read Benchmark ===`);
        
        // Point queries
        const pointQueryStart = performance.now();
        for (let i = 0; i < 2000; i++) {
            const randomId = Math.floor(Math.random() * TEST_SIZE) + 1;
            await bunDriver.query('SELECT * FROM bun_benchmark_test WHERE id = ?', [randomId]);
        }
        const pointQueryTime = performance.now() - pointQueryStart;
        
        // Range queries with index
        const rangeQueryStart = performance.now();
        for (let i = 0; i < 200; i++) {
            const minAge = 20 + (i % 30);
            await bunDriver.query('SELECT * FROM bun_benchmark_test WHERE age BETWEEN ? AND ?', [minAge, minAge + 10]);
        }
        const rangeQueryTime = performance.now() - rangeQueryStart;
        
        // Complex queries
        const complexQueryStart = performance.now();
        for (let i = 0; i < 100; i++) {
            await bunDriver.query(
                'SELECT * FROM bun_benchmark_test WHERE active = ? AND score > ? ORDER BY created_at DESC LIMIT 10',
                [true, 50]
            );
        }
        const complexQueryTime = performance.now() - complexQueryStart;
        
        // Full table scan
        const fullScanStart = performance.now();
        await bunDriver.query('SELECT COUNT(*) as total, AVG(score) as avg_score FROM bun_benchmark_test');
        const fullScanTime = performance.now() - fullScanStart;
        
        console.log(`Point Queries: 2000 operations in ${pointQueryTime.toFixed(2)}ms`);
        console.log(`Queries/sec: ${Math.round(2000 / (pointQueryTime / 1000))}`);
        console.log(`Range Queries: 200 operations in ${rangeQueryTime.toFixed(2)}ms`);
        console.log(`Range/sec: ${Math.round(200 / (rangeQueryTime / 1000))}`);
        console.log(`Complex Queries: 100 operations in ${complexQueryTime.toFixed(2)}ms`);
        console.log(`Complex/sec: ${Math.round(100 / (complexQueryTime / 1000))}`);
        console.log(`Full Scan: ${fullScanTime.toFixed(2)}ms`);
        
        return {
            pointQueries: { time: pointQueryTime, opsPerSec: 2000 / (pointQueryTime / 1000) },
            rangeQueries: { time: rangeQueryTime, opsPerSec: 200 / (rangeQueryTime / 1000) },
            complexQueries: { time: complexQueryTime, opsPerSec: 100 / (complexQueryTime / 1000) },
            fullScan: { time: fullScanTime }
        };
    }

    async function benchmarkSyncReads() {
        console.log(`\n=== Bun Sync Read Benchmark ===`);
        
        // Point queries
        const pointQueryStart = performance.now();
        for (let i = 0; i < 2000; i++) {
            const randomId = Math.floor(Math.random() * TEST_SIZE) + 1;
            bunDriver.querySync('SELECT * FROM bun_benchmark_test WHERE id = ?', [randomId]);
        }
        const pointQueryTime = performance.now() - pointQueryStart;
        
        // Range queries with index
        const rangeQueryStart = performance.now();
        for (let i = 0; i < 200; i++) {
            const minAge = 20 + (i % 30);
            bunDriver.querySync('SELECT * FROM bun_benchmark_test WHERE age BETWEEN ? AND ?', [minAge, minAge + 10]);
        }
        const rangeQueryTime = performance.now() - rangeQueryStart;
        
        console.log(`Sync Point Queries: 2000 operations in ${pointQueryTime.toFixed(2)}ms`);
        console.log(`Queries/sec: ${Math.round(2000 / (pointQueryTime / 1000))}`);
        console.log(`Sync Range Queries: 200 operations in ${rangeQueryTime.toFixed(2)}ms`);
        console.log(`Range/sec: ${Math.round(200 / (rangeQueryTime / 1000))}`);
        
        return {
            pointQueries: { time: pointQueryTime, opsPerSec: 2000 / (pointQueryTime / 1000) },
            rangeQueries: { time: rangeQueryTime, opsPerSec: 200 / (rangeQueryTime / 1000) }
        };
    }

    async function benchmarkUpdates() {
        console.log(`\n=== Bun Update Benchmark ===`);
        
        // Async updates
        const asyncUpdateStart = performance.now();
        for (let i = 0; i < 1000; i++) {
            const randomId = Math.floor(Math.random() * TEST_SIZE) + 1;
            const newScore = Math.random() * 100;
            await bunDriver.exec(
                'UPDATE bun_benchmark_test SET score = ?, updated_at = ? WHERE id = ?', 
                [newScore, new Date().toISOString(), randomId]
            );
        }
        const asyncUpdateTime = performance.now() - asyncUpdateStart;
        
        // Sync updates
        const syncUpdateStart = performance.now();
        for (let i = 0; i < 1000; i++) {
            const randomId = Math.floor(Math.random() * TEST_SIZE) + 1;
            const newScore = Math.random() * 100;
            bunDriver.execSync(
                'UPDATE bun_benchmark_test SET score = ?, updated_at = ? WHERE id = ?', 
                [newScore, new Date().toISOString(), randomId]
            );
        }
        const syncUpdateTime = performance.now() - syncUpdateStart;
        
        console.log(`Async Updates: 1000 operations in ${asyncUpdateTime.toFixed(2)}ms`);
        console.log(`Async Updates/sec: ${Math.round(1000 / (asyncUpdateTime / 1000))}`);
        console.log(`Sync Updates: 1000 operations in ${syncUpdateTime.toFixed(2)}ms`);
        console.log(`Sync Updates/sec: ${Math.round(1000 / (syncUpdateTime / 1000))}`);
        
        return {
            async: { time: asyncUpdateTime, opsPerSec: 1000 / (asyncUpdateTime / 1000) },
            sync: { time: syncUpdateTime, opsPerSec: 1000 / (syncUpdateTime / 1000) }
        };
    }

    async function benchmarkDeletes() {
        console.log(`\n=== Bun Delete Benchmark ===`);
        
        const deleteCount = Math.floor(TEST_SIZE * 0.1); // Delete 10%
        
        // Async deletes
        const asyncDeleteStart = performance.now();
        for (let i = 0; i < deleteCount / 2; i++) {
            const randomId = Math.floor(Math.random() * TEST_SIZE) + 1;
            await bunDriver.exec('DELETE FROM bun_benchmark_test WHERE id = ?', [randomId]);
        }
        const asyncDeleteTime = performance.now() - asyncDeleteStart;
        
        // Sync deletes
        const syncDeleteStart = performance.now();
        for (let i = 0; i < deleteCount / 2; i++) {
            const randomId = Math.floor(Math.random() * TEST_SIZE) + 1;
            bunDriver.execSync('DELETE FROM bun_benchmark_test WHERE id = ?', [randomId]);
        }
        const syncDeleteTime = performance.now() - syncDeleteStart;
        
        console.log(`Async Deletes: ${deleteCount / 2} operations in ${asyncDeleteTime.toFixed(2)}ms`);
        console.log(`Async Deletes/sec: ${Math.round((deleteCount / 2) / (asyncDeleteTime / 1000))}`);
        console.log(`Sync Deletes: ${deleteCount / 2} operations in ${syncDeleteTime.toFixed(2)}ms`);
        console.log(`Sync Deletes/sec: ${Math.round((deleteCount / 2) / (syncDeleteTime / 1000))}`);
        
        return {
            async: { time: asyncDeleteTime, opsPerSec: (deleteCount / 2) / (asyncDeleteTime / 1000) },
            sync: { time: syncDeleteTime, opsPerSec: (deleteCount / 2) / (syncDeleteTime / 1000) }
        };
    }

    async function benchmarkTransactions() {
        console.log(`\n=== Bun Transaction Benchmark ===`);
        
        const transactionStart = performance.now();
        await bunDriver.transaction(async () => {
            for (let i = 0; i < 500; i++) {
                await bunDriver.exec(
                    'INSERT INTO bun_benchmark_test (name, email, age, score, active, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        `TxUser${i}`, 
                        `txuser${i}@test.com`, 
                        30, 
                        50.0, 
                        true,
                        JSON.stringify({ transaction: true }),
                        new Date().toISOString(),
                        new Date().toISOString()
                    ]
                );
                await bunDriver.exec('UPDATE bun_benchmark_test SET score = ? WHERE name = ?', [75.0, `TxUser${i}`]);
            }
        });
        const transactionTime = performance.now() - transactionStart;
        
        console.log(`Transaction (1000 ops): ${transactionTime.toFixed(2)}ms`);
        console.log(`Ops/sec in transaction: ${Math.round(1000 / (transactionTime / 1000))}`);
        
        return {
            time: transactionTime,
            opsPerSec: 1000 / (transactionTime / 1000)
        };
    }

    async function benchmarkConcurrentOperations() {
        console.log(`\n=== Bun Concurrent Operations Benchmark ===`);
        
        const concurrentStart = performance.now();
        
        // Run multiple operations concurrently
        const operations = [
            async () => {
                for (let i = 0; i < 100; i++) {
                    await bunDriver.exec(
                        'INSERT INTO bun_benchmark_test (name, email, age, score, active, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [`Concurrent${i}`, `concurrent${i}@test.com`, 25, 50, true, '{}', new Date().toISOString(), new Date().toISOString()]
                    );
                }
            },
            async () => {
                for (let i = 0; i < 100; i++) {
                    await bunDriver.query('SELECT * FROM bun_benchmark_test WHERE active = ? LIMIT 10', [true]);
                }
            },
            async () => {
                for (let i = 0; i < 50; i++) {
                    const randomId = Math.floor(Math.random() * 1000) + 1;
                    await bunDriver.exec('UPDATE bun_benchmark_test SET score = ? WHERE id = ?', [Math.random() * 100, randomId]);
                }
            }
        ];
        
        await Promise.all(operations);
        const concurrentTime = performance.now() - concurrentStart;
        
        console.log(`Concurrent Operations (250 total): ${concurrentTime.toFixed(2)}ms`);
        console.log(`Concurrent Ops/sec: ${Math.round(250 / (concurrentTime / 1000))}`);
        
        return {
            time: concurrentTime,
            opsPerSec: 250 / (concurrentTime / 1000)
        };
    }

    test('should benchmark Bun driver performance comprehensively', async () => {
        console.log('\n🚀 Starting Bun Driver Comprehensive Performance Benchmark');
        console.log(`Test size: ${TEST_SIZE} operations`);
        
        // Warmup
        console.log('\n⚡ Warming up Bun driver...');
        await warmupDriver();
        
        const results: any = {};

        // Run all benchmarks
        results.asyncInserts = await benchmarkAsyncInserts();
        results.syncInserts = await benchmarkSyncInserts();
        results.asyncReads = await benchmarkAsyncReads();
        results.syncReads = await benchmarkSyncReads();
        results.updates = await benchmarkUpdates();
        results.deletes = await benchmarkDeletes();
        results.transactions = await benchmarkTransactions();
        results.concurrent = await benchmarkConcurrentOperations();

        // Performance comparison summary
        console.log('\n📈 Bun Driver Performance Summary');
        console.log('===============================================');
        
        console.log(`\nInsert Performance:`);
        console.log(`  Async: ${results.asyncInserts.opsPerSec.toFixed(0)} ops/sec`);
        console.log(`  Sync:  ${results.syncInserts.opsPerSec.toFixed(0)} ops/sec`);
        const insertRatio = results.syncInserts.opsPerSec / results.asyncInserts.opsPerSec;
        console.log(`  Sync is ${insertRatio > 1 ? insertRatio.toFixed(2) + 'x faster' : (1/insertRatio).toFixed(2) + 'x slower'} than async`);
        
        console.log(`\nRead Performance:`);
        console.log(`  Async Point Queries: ${results.asyncReads.pointQueries.opsPerSec.toFixed(0)} ops/sec`);
        console.log(`  Sync Point Queries:  ${results.syncReads.pointQueries.opsPerSec.toFixed(0)} ops/sec`);
        const readRatio = results.syncReads.pointQueries.opsPerSec / results.asyncReads.pointQueries.opsPerSec;
        console.log(`  Sync is ${readRatio > 1 ? readRatio.toFixed(2) + 'x faster' : (1/readRatio).toFixed(2) + 'x slower'} than async`);
        
        console.log(`\nUpdate Performance:`);
        console.log(`  Async: ${results.updates.async.opsPerSec.toFixed(0)} ops/sec`);
        console.log(`  Sync:  ${results.updates.sync.opsPerSec.toFixed(0)} ops/sec`);
        
        console.log(`\nDelete Performance:`);
        console.log(`  Async: ${results.deletes.async.opsPerSec.toFixed(0)} ops/sec`);
        console.log(`  Sync:  ${results.deletes.sync.opsPerSec.toFixed(0)} ops/sec`);
        
        console.log(`\nAdvanced Operations:`);
        console.log(`  Transactions: ${results.transactions.opsPerSec.toFixed(0)} ops/sec`);
        console.log(`  Concurrent:   ${results.concurrent.opsPerSec.toFixed(0)} ops/sec`);
        
        console.log(`\nOverall Assessment:`);
        const avgAsyncPerf = (results.asyncInserts.opsPerSec + results.asyncReads.pointQueries.opsPerSec + results.updates.async.opsPerSec) / 3;
        const avgSyncPerf = (results.syncInserts.opsPerSec + results.syncReads.pointQueries.opsPerSec + results.updates.sync.opsPerSec) / 3;
        console.log(`  Average Async Performance: ${avgAsyncPerf.toFixed(0)} ops/sec`);
        console.log(`  Average Sync Performance:  ${avgSyncPerf.toFixed(0)} ops/sec`);
        
        if (avgSyncPerf > avgAsyncPerf) {
            console.log(`  🏆 Sync operations are ${(avgSyncPerf/avgAsyncPerf).toFixed(2)}x faster on average`);
        } else {
            console.log(`  🏆 Async operations are ${(avgAsyncPerf/avgSyncPerf).toFixed(2)}x faster on average`);
        }

        // Close driver
        await bunDriver.close();

        // Basic assertion to ensure test passes
        expect(results.asyncInserts.opsPerSec).toBeGreaterThan(0);
        expect(results.syncInserts.opsPerSec).toBeGreaterThan(0);
        
        console.log('\n✅ Bun Driver benchmark completed successfully!');
    }, 120000); // 2 minute timeout
});