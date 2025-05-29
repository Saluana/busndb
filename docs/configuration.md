# BusNDB Configuration Guide

BusNDB provides extensive configuration options to optimize SQLite performance for your specific use case. This guide covers all available configuration options with practical examples and performance recommendations.

## Table of Contents

- [Basic Configuration](#basic-configuration)
- [SQLite Optimization Options](#sqlite-optimization-options)
- [Performance Profiles](#performance-profiles)
- [Configuration Reference](#configuration-reference)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Basic Configuration

### Default Configuration (Recommended)

```typescript
import { createDB } from 'busndb';

// Uses optimized defaults - perfect for most applications
const db = createDB({
    path: './data/app.db'
});
```

**Default Settings:**
- WAL mode for better concurrency
- 5-second busy timeout
- 64MB cache size
- Memory temporary storage
- Auto-checkpoint every 1000 pages
- Foreign keys enabled

### In-Memory Database

```typescript
// Fast, temporary database - perfect for testing or caching
const memoryDB = createDB({
    memory: true
});
```

### Driver Selection

```typescript
// Explicitly choose driver (auto-detected by default)
const db = createDB({
    path: './app.db',
    driver: 'bun'  // or 'node'
});
```

## SQLite Optimization Options

### Journal Modes

The journal mode determines how SQLite handles transactions and concurrency:

```typescript
// WAL Mode (Default) - Best for most applications
const walDB = createDB({
    path: './app.db',
    sqlite: {
        journalMode: 'WAL'  // Multiple readers, one writer
    }
});

// DELETE Mode - Traditional rollback journal
const deleteDB = createDB({
    path: './legacy.db',
    sqlite: {
        journalMode: 'DELETE'  // Single writer, blocks readers
    }
});

// MEMORY Mode - Fastest, but no crash recovery
const speedDB = createDB({
    path: './temp.db',
    sqlite: {
        journalMode: 'MEMORY'  // Maximum speed, minimum safety
    }
});
```

**Journal Mode Comparison:**
- **WAL**: Best concurrency, allows concurrent reads/writes
- **DELETE**: Traditional mode, good compatibility
- **TRUNCATE**: Similar to DELETE but faster
- **PERSIST**: Reuses journal file
- **MEMORY**: Fastest but no crash protection

### Synchronization Levels

Controls how often SQLite syncs to disk:

```typescript
// High Performance (Default)
const fastDB = createDB({
    path: './app.db',
    sqlite: {
        synchronous: 'NORMAL'  // Good balance of speed and safety
    }
});

// Maximum Safety
const safeDB = createDB({
    path: './critical.db',
    sqlite: {
        synchronous: 'FULL'  // Maximum durability, slower writes
    }
});

// Maximum Speed (Use with caution)
const speedDB = createDB({
    path: './cache.db',
    sqlite: {
        synchronous: 'OFF'  // Fastest, risk of corruption on crash
    }
});
```

### Cache Configuration

SQLite cache significantly impacts performance:

```typescript
// Large Cache for Read-Heavy Applications
const bigCacheDB = createDB({
    path: './analytics.db',
    sqlite: {
        cacheSize: -256000  // 256MB cache (negative = KB)
    }
});

// Small Cache for Memory-Constrained Environments
const smallCacheDB = createDB({
    path: './embedded.db',
    sqlite: {
        cacheSize: 1000  // 1000 pages (positive = pages)
    }
});
```

**Cache Size Guidelines:**
- `-64000` (64MB): Default, good for most applications
- `-128000` (128MB): Large datasets, read-heavy workloads
- `-32000` (32MB): Small applications, limited memory
- `2000` pages: Very small cache for embedded systems

### Busy Timeout

Handles database locking conflicts:

```typescript
// High-Concurrency Application
const busyDB = createDB({
    path: './concurrent.db',
    sqlite: {
        busyTimeout: 30000  // 30 seconds - wait longer for locks
    }
});

// Low-Latency Application
const quickDB = createDB({
    path: './realtime.db',
    sqlite: {
        busyTimeout: 1000  // 1 second - fail fast on conflicts
    }
});
```

## Performance Profiles

### High-Performance Read-Heavy Workload

Perfect for analytics, reporting, or data warehousing:

```typescript
const analyticsDB = createDB({
    path: './analytics.db',
    sqlite: {
        journalMode: 'WAL',
        synchronous: 'NORMAL',
        busyTimeout: 15000,     // Allow longer waits for heavy queries
        cacheSize: -256000,     // 256MB cache for large datasets
        tempStore: 'MEMORY',    // Fast temporary operations
        walCheckpoint: 10000    // Less frequent checkpoints
    }
});
```

**Best for:**
- Data analytics
- Reporting systems
- Read-heavy APIs
- Business intelligence

### Maximum Safety Configuration

For critical data that cannot be lost:

```typescript
const criticalDB = createDB({
    path: './financial.db',
    sqlite: {
        journalMode: 'WAL',
        synchronous: 'FULL',    // Maximum durability
        busyTimeout: 30000,     // Patient with locks
        cacheSize: -32000,      // Conservative cache size
        tempStore: 'FILE',      // Persistent temporary storage
        autoVacuum: 'FULL',     // Keep database compact
        lockingMode: 'NORMAL'   // Allow concurrent access
    }
});
```

**Best for:**
- Financial systems
- User account data
- Transaction logs
- Regulatory compliance

### High-Throughput Write Workload

Optimized for frequent writes and updates:

```typescript
const writeHeavyDB = createDB({
    path: './logs.db',
    sqlite: {
        journalMode: 'WAL',
        synchronous: 'NORMAL',
        busyTimeout: 5000,
        cacheSize: -128000,     // Good cache for write buffering
        tempStore: 'MEMORY',
        walCheckpoint: 5000,    // More frequent checkpoints
        autoVacuum: 'INCREMENTAL'  // Gradual cleanup
    }
});
```

**Best for:**
- Logging systems
- Event streaming
- Real-time data ingestion
- IoT data collection

### Embedded/Mobile Configuration

Optimized for resource-constrained environments:

```typescript
const embeddedDB = createDB({
    path: './mobile.db',
    sqlite: {
        journalMode: 'DELETE',  // Simpler, less memory
        synchronous: 'NORMAL',
        busyTimeout: 3000,
        cacheSize: 2000,        // Small cache (2000 pages)
        tempStore: 'FILE',      // Don't use precious RAM
        autoVacuum: 'FULL'      // Keep database small
    }
});
```

**Best for:**
- Mobile applications
- Embedded systems
- Raspberry Pi projects
- Memory-constrained environments

### Development/Testing Configuration

Fast and convenient for development:

```typescript
const devDB = createDB({
    memory: true,  // No persistence needed
    sqlite: {
        journalMode: 'MEMORY',
        synchronous: 'OFF',     // Maximum speed
        cacheSize: -32000,      // Reasonable cache
        tempStore: 'MEMORY'
    }
});
```

**Best for:**
- Unit tests
- Development databases
- Temporary data processing
- Prototyping

## Configuration Reference

### Complete DBConfig Interface

```typescript
interface DBConfig {
    // Basic Options
    path?: string;           // Database file path
    memory?: boolean;        // Use in-memory database
    driver?: 'bun' | 'node'; // Driver selection

    // LibSQL Options (for distributed SQLite)
    authToken?: string;      // LibSQL authentication
    syncUrl?: string;        // LibSQL sync URL
    libsql?: boolean;        // Force LibSQL usage

    // SQLite Optimization Options
    sqlite?: {
        journalMode?: 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'WAL';
        synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
        busyTimeout?: number;    // Milliseconds to wait for locks
        cacheSize?: number;      // Cache size (negative = KB, positive = pages)
        tempStore?: 'DEFAULT' | 'FILE' | 'MEMORY';
        lockingMode?: 'NORMAL' | 'EXCLUSIVE';
        autoVacuum?: 'NONE' | 'FULL' | 'INCREMENTAL';
        walCheckpoint?: number;  // Pages before auto-checkpoint
    };
}
```

### Option Details

#### Journal Mode Options
- **WAL** (Default): Best concurrency, multiple readers + one writer
- **DELETE**: Traditional mode, good compatibility, single writer
- **TRUNCATE**: Similar to DELETE but faster on some filesystems
- **PERSIST**: Reuses journal file, reduces file operations
- **MEMORY**: Fastest, but no crash recovery

#### Synchronous Options
- **OFF**: No syncing, maximum speed, data loss risk on crash
- **NORMAL** (Default): Sync at critical moments, good balance
- **FULL**: Sync frequently, maximum safety, slower
- **EXTRA**: Sync even more frequently, paranoid mode

#### Cache Size Guidelines
- **Negative values**: Size in KB (e.g., -64000 = 64MB)
- **Positive values**: Size in pages (e.g., 2000 = ~8MB typically)
- **Recommended**: -64000 to -128000 for most applications

#### Temp Store Options
- **MEMORY** (Default): Store temporary data in RAM
- **FILE**: Store temporary data on disk
- **DEFAULT**: Let SQLite decide

## Best Practices

### 1. Start with Defaults

The default configuration is optimized for most use cases:

```typescript
// This is usually all you need
const db = createDB({ path: './app.db' });
```

### 2. Profile Before Optimizing

Use the built-in benchmarks to understand your performance characteristics:

```typescript
// Run benchmarks to understand your workload
npm run benchmark
```

### 3. Match Configuration to Workload

| Workload Type | Recommended Profile |
|---------------|-------------------|
| Read-heavy analytics | High-performance read-heavy |
| Financial/critical data | Maximum safety |
| High-volume logging | High-throughput write |
| Mobile/embedded | Embedded/mobile |
| Development/testing | Development/testing |

### 4. Monitor WAL File Size

For WAL mode, monitor the WAL file size:

```typescript
// Checkpoint manually if needed
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
```

### 5. Consider Auto-Vacuum

Choose the right auto-vacuum mode:
- **NONE**: Fastest, but database grows
- **FULL**: Keeps database compact, slower writes
- **INCREMENTAL**: Gradual cleanup, balanced approach

## Troubleshooting

### Database Locked Errors

If you see "database is locked" errors:

```typescript
const db = createDB({
    path: './app.db',
    sqlite: {
        busyTimeout: 10000  // Increase timeout
    }
});
```

### High Memory Usage

If SQLite uses too much memory:

```typescript
const db = createDB({
    path: './app.db',
    sqlite: {
        cacheSize: -32000,   // Reduce cache size
        tempStore: 'FILE'    // Use disk for temp data
    }
});
```

### Slow Write Performance

For slow writes in WAL mode:

```typescript
const db = createDB({
    path: './app.db',
    sqlite: {
        walCheckpoint: 5000,  // More frequent checkpoints
        synchronous: 'NORMAL' // Ensure not set to FULL
    }
});
```

### Database File Size Issues

If database file grows too large:

```typescript
const db = createDB({
    path: './app.db',
    sqlite: {
        autoVacuum: 'INCREMENTAL'  // Gradual cleanup
    }
});

// Or run vacuum manually
db.exec('VACUUM');
```

### LibSQL Configuration

For distributed SQLite with LibSQL:

```typescript
const remoteDB = createDB({
    path: 'libsql://your-database.turso.io',
    authToken: 'your-auth-token',
    syncUrl: 'libsql://your-database.turso.io'  // For embedded replicas
});
```

## Performance Testing

Test your configuration with the built-in benchmarks:

```bash
# Run performance benchmarks
npm run benchmark

# Test with your specific configuration
npm run benchmark:sql
```

Monitor key metrics:
- Operations per second
- Memory usage
- Database file size
- WAL file size (if using WAL mode)

Remember: the best configuration depends on your specific use case. Start with defaults and optimize based on real-world performance testing.