import { BaseDriver } from './base';
import type { DBConfig, Row } from '../types';
import * as os from 'os';

// Mock the 'os' module
jest.mock('os');

// Helper to correctly type mocked functions in Jest
const mocked = <T extends (...args: any[]) => any>(fn: T): jest.MockedFunction<T> => fn as jest.MockedFunction<T>;

// Constants for cache sizes (mirroring those in base.ts for clarity in tests)
const MIN_CACHE_KIB_TEST = -16000; // 16MB
const MAX_CACHE_KIB_TEST = -256000; // 256MB
const MB_IN_BYTES_TEST = 1024 * 1024;

class TestableDriver extends BaseDriver {
    // Store calls to execSync for verification
    public execSyncLog: string[] = [];

    constructor(config: DBConfig = { driver: 'sqlite', dbName: 'test.db' }) {
        super(config);
        // Call initializeDriver as BaseDriver constructor expects child classes to do so.
        this.initializeDriver(config);
    }

    protected initializeDriver(_config: DBConfig): void {
        // Minimal implementation
    }

    protected async _query(_sql: string, _params?: any[]): Promise<Row[]> {
        return [];
    }

    protected _querySync(_sql: string, _params?: any[]): Row[] {
        return [];
    }

    public async exec(_sql: string, _params?: any[]): Promise<void> {
        // Minimal implementation
    }

    public execSync(sql: string, _params?: any[]): void {
        this.execSyncLog.push(sql);
        // Minimal implementation, actual db interaction not needed for this test
    }

    protected async closeDatabase(): Promise<void> {
        // Minimal implementation
    }

    protected closeDatabaseSync(): void {
        // Minimal implementation
    }

    // Public method to expose configureSQLite for testing
    public testConfigureSQLite(configOverride: DBConfig = {}): void {
        // Allow overriding parts of the config for specific tests if needed,
        // but primarily use the one set in constructor.
        const testConfig = { ...this.config, ...configOverride };
        this.configureSQLite(testConfig);
    }

    // Public method to set queryCount for testing
    public setQueryCount(count: number): void {
        this.queryCount = count;
    }

    // Helper to get the last cache_size pragma
    public getLastCacheSizePragma(): string | undefined {
        return this.execSyncLog.find(cmd => cmd.startsWith('PRAGMA cache_size'));
    }
}

describe('BaseDriver - configureSQLite Auto-tuning Cache Logic', () => {
    let driver: TestableDriver;
    let execSyncSpy: jest.SpyInstance;

    beforeEach(() => {
        driver = new TestableDriver();
        // Spy on the actual execSync method of the TestableDriver instance
        execSyncSpy = jest.spyOn(driver, 'execSync');
        // Clear mock calls for os.freemem for each test
        mocked(os.freemem).mockClear();
    });

    afterEach(() => {
        // Restore original implementation and clear logs
        execSyncSpy.mockRestore();
        driver.execSyncLog = [];
    });

    test('should default to MIN_CACHE_KIB if free memory is very low (< 160MB)', () => {
        mocked(os.freemem).mockReturnValue(150 * MB_IN_BYTES_TEST); // 150MB
        driver.setQueryCount(500); // Medium query count
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${MIN_CACHE_KIB_TEST}`);
        expect(execSyncSpy).toHaveBeenCalledWith(`PRAGMA cache_size = ${MIN_CACHE_KIB_TEST}`);
    });

    test('sufficient memory, low query count (<100), should use 50% of 10% of free memory', () => {
        const freeMem = 1000 * MB_IN_BYTES_TEST; // 1GB
        mocked(os.freemem).mockReturnValue(freeMem);
        driver.setQueryCount(50);

        // Expected: 0.10 * freeMem = 100MB. 50% of this = 50MB.
        // 50MB = 50 * 1024 KiB = 51200 KiB. Negative: -51200
        const expectedCacheKiB = -Math.floor((freeMem * 0.10 * 0.50) / 1024);
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${expectedCacheKiB}`);
    });

    test('sufficient memory, medium query count (100-999), should use 100% of 10% of free memory', () => {
        const freeMem = 1000 * MB_IN_BYTES_TEST; // 1GB
        mocked(os.freemem).mockReturnValue(freeMem);
        driver.setQueryCount(500);

        // Expected: 0.10 * freeMem = 100MB.
        // 100MB = 100 * 1024 KiB = 102400 KiB. Negative: -102400
        const expectedCacheKiB = -Math.floor((freeMem * 0.10) / 1024);
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${expectedCacheKiB}`);
    });

    test('sufficient memory, high query count (>=1000), should use 150% of 10% of free memory', () => {
        const freeMem = 1000 * MB_IN_BYTES_TEST; // 1GB
        mocked(os.freemem).mockReturnValue(freeMem);
        driver.setQueryCount(1500);

        // Expected: 0.10 * freeMem = 100MB. 150% of this = 150MB.
        // 150MB = 150 * 1024 KiB = 153600 KiB. Negative: -153600
        const expectedCacheKiB = -Math.floor((freeMem * 0.10 * 1.50) / 1024);
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${expectedCacheKiB}`);
    });

    test('should clamp at MAX_CACHE_KIB if calculated value exceeds it', () => {
        // 5GB free memory, high query count
        const freeMem = 5000 * MB_IN_BYTES_TEST; // 5GB
        mocked(os.freemem).mockReturnValue(freeMem);
        driver.setQueryCount(2000);

        // Calculation: 0.10 * 5000MB = 500MB. 1.5 * 500MB = 750MB.
        // 750MB is much larger than MAX_CACHE_KIB (256MB).
        // So, it should be clamped to MAX_CACHE_KIB_TEST.
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${MAX_CACHE_KIB_TEST}`);
    });

    test('should clamp at MIN_CACHE_KIB if calculated value is below it (but memory not "very low")', () => {
        // 200MB free memory, low query count.
        // 10% of 200MB = 20MB. 50% of 20MB = 10MB.
        // 10MB is less than MIN_CACHE_KIB (16MB).
        // So, it should be clamped to MIN_CACHE_KIB_TEST.
        const freeMem = 200 * MB_IN_BYTES_TEST;
        mocked(os.freemem).mockReturnValue(freeMem);
        driver.setQueryCount(10); // Low query count
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${MIN_CACHE_KIB_TEST}`);
    });

    test('realistic scenario: 800MB free RAM, 850 queries', () => {
        const freeMem = 800 * MB_IN_BYTES_TEST; // 800MB
        mocked(os.freemem).mockReturnValue(freeMem);
        driver.setQueryCount(850); // Medium query count (100% of base)

        // Expected: 0.10 * 800MB = 80MB.
        // 80MB = 80 * 1024 KiB = 81920 KiB. Negative: -81920
        const expectedCacheKiB = -Math.floor((freeMem * 0.10) / 1024);
        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${expectedCacheKiB}`);
    });

    test('configureSQLite should use config from constructor if no override', () => {
        // Set a specific dbName in constructor
        driver = new TestableDriver({ driver: 'sqlite', dbName: 'constructor.db' });
        execSyncSpy = jest.spyOn(driver, 'execSync'); // Re-spy after new TestableDriver

        mocked(os.freemem).mockReturnValue(500 * MB_IN_BYTES_TEST);
        driver.setQueryCount(100);
        driver.testConfigureSQLite(); // Call without override

        // The main check here is that configureSQLite runs with the driver.config
        // which would have dbName: 'constructor.db'. The cache calculation is one part of it.
        const expectedCacheKiB = -Math.floor((500 * MB_IN_BYTES_TEST * 0.10) / 1024);
        expect(driver.getLastCacheSizePragma()).toBe(`PRAGMA cache_size = ${expectedCacheKiB}`);
    });

    test('error during os.freemem() call should default to MIN_CACHE_KIB and log warning', () => {
        mocked(os.freemem).mockImplementation(() => {
            throw new Error('OS Error');
        });
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        driver.testConfigureSQLite();

        const cachePragma = driver.getLastCacheSizePragma();
        expect(cachePragma).toBe(`PRAGMA cache_size = ${MIN_CACHE_KIB_TEST}`);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Warning: Failed to calculate dynamic cache size, defaulting to MIN_CACHE_KIB. Error:',
            expect.any(Error)
        );

        consoleWarnSpy.mockRestore();
    });
});
