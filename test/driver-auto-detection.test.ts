/**
 * Shared Driver Auto-Detection Tests
 *
 * This file contains basic tests that should work in both Bun and Node.js.
 * For runtime-specific tests, see:
 * - driver-auto-detection-bun.test.ts (Bun-specific tests)
 * - driver-auto-detection-node.test.ts (Node.js-specific tests)
 */

import { describe, it, expect } from 'bun:test';
import { Database } from '../src/database';
import {
    detectDriver,
    getEnvironment,
    getDiagnostics,
} from '../src/driver-detector';
import type { DBConfig } from '../src/types';

describe('Driver Auto-Detection - Basic Tests', () => {
    describe('Driver Detection Logic', () => {
        it('should always return a valid driver', () => {
            const result = detectDriver();

            expect(result.recommendedDriver).toMatch(/^(bun|node)$/);
            expect(result.environment.confidence).toBeGreaterThanOrEqual(0);
            expect(result.environment.confidence).toBeLessThanOrEqual(100);
            expect(result.environment.runtime).toMatch(/^(bun|node|unknown)$/);
        });

        it('should provide environment information', () => {
            const environment = getEnvironment();

            expect(environment.runtime).toBeDefined();
            expect(environment.confidence).toBeGreaterThanOrEqual(0);
            expect(environment.capabilities).toBeDefined();
            expect(typeof environment.capabilities.hasBuiltinSQLite).toBe(
                'boolean'
            );
        });

        it('should provide diagnostics information', () => {
            const diagnostics = getDiagnostics();

            expect(diagnostics).toBeDefined();
            expect(typeof diagnostics).toBe('object');
        });

        it('should handle explicit driver configuration', () => {
            const config: DBConfig = {
                driver: 'bun',
                path: ':memory:',
            };

            const result = detectDriver(config);
            expect(result.recommendedDriver).toBe('bun');
        });

        it('should provide fallback drivers', () => {
            const result = detectDriver();

            expect(Array.isArray(result.fallbackDrivers)).toBe(true);
            expect(result.fallbackDrivers.length).toBeGreaterThan(0);
        });
    });

    describe('Database Creation', () => {
        it('should create database with auto-detected driver', () => {
            const config: DBConfig = { path: ':memory:' };

            expect(() => {
                const db = new Database(config);
                db.close();
            }).not.toThrow();
        });

        it('should handle invalid driver gracefully', () => {
            const config: DBConfig = {
                driver: 'invalid' as any,
                path: ':memory:',
            };

            expect(() => new Database(config)).toThrow();
        });
    });

    describe('Environment Variable Support', () => {
        it('should read DATABASE_DRIVER environment variable', () => {
            const originalEnv = process.env.DATABASE_DRIVER;
            process.env.DATABASE_DRIVER = 'bun';

            try {
                const result = detectDriver();
                expect(
                    result.warnings.some((w) => w.includes('DATABASE_DRIVER'))
                ).toBe(true);
            } finally {
                if (originalEnv !== undefined) {
                    process.env.DATABASE_DRIVER = originalEnv;
                } else {
                    delete process.env.DATABASE_DRIVER;
                }
            }
        });

        it('should validate environment variable values', () => {
            const originalEnv = process.env.DATABASE_DRIVER;
            process.env.DATABASE_DRIVER = 'invalid';

            try {
                const config: DBConfig = { path: ':memory:' };
                expect(() => new Database(config)).toThrow();
            } finally {
                if (originalEnv !== undefined) {
                    process.env.DATABASE_DRIVER = originalEnv;
                } else {
                    delete process.env.DATABASE_DRIVER;
                }
            }
        });
    });

    describe('Error Handling', () => {
        it('should provide meaningful error messages', () => {
            const config: DBConfig = {
                driver: 'invalid' as any,
                path: ':memory:',
            };

            try {
                new Database(config);
            } catch (error) {
                expect(error instanceof Error).toBe(true);
                expect((error as Error).message.length).toBeGreaterThan(0);
            }
        });

        it('should handle edge cases gracefully', () => {
            const result = detectDriver({});

            expect(result.recommendedDriver).toMatch(/^(bun|node)$/);
            expect(Array.isArray(result.warnings)).toBe(true);
        });
    });
});
