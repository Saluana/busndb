import { test, expect, describe, beforeEach } from 'bun:test';
import { PluginManager, PluginError, PluginTimeoutError } from '../src/plugin-system';
import type { Plugin, PluginContext, CollectionSchema } from '../src/plugin-system'; // Assuming CollectionSchema is also exported or defined there, or adjust

describe('PluginManager', () => {
    let pluginManager: PluginManager;
    let dummyContext: PluginContext;

    beforeEach(() => {
        pluginManager = new PluginManager(); // Default options
        dummyContext = {
            collectionName: 'testCollection',
            // A simplified CollectionSchema for tests if the real one is too complex or not easily mockable
            schema: {
                name: 'testCollection',
                fields: [{ name: 'id', type: 'string', unique: true, primaryKey: true }],
                primaryKey: 'id',
                indexes: [],
                constraints: []
            } as unknown as CollectionSchema, // Using unknown to bypass strict CollectionSchema typing for tests
            operation: 'testOperation',
            data: { id: 1, name: 'testData' },
            result: undefined,
            error: undefined,
        };
    });

    // Test cases will be added here
    test('handles synchronous errors from plugin hooks correctly (strictMode)', async () => {
        pluginManager = new PluginManager({ strictMode: true });

        const errorPlugin: Plugin = {
            name: 'ErrorPluginSync',
            onBeforeInsert: (context: PluginContext) => {
                throw new Error('Intentional sync error in hook');
            },
        };

        pluginManager.register(errorPlugin);
        dummyContext.operation = 'onBeforeInsert'; // Align context operation with hook name for clarity

        try {
            await pluginManager.executeHook('onBeforeInsert', dummyContext);
            // If executeHook resolves, the test should fail, as strictMode should throw
            expect(true).toBe(false);
        } catch (error: any) {
            expect(error).toBeInstanceOf(PluginError);

            if (error instanceof PluginError) {
                expect(error.message).toBe("Plugin 'ErrorPluginSync' hook 'onBeforeInsert' threw synchronous error: Intentional sync error in hook");
                expect(error.pluginName).toBe('ErrorPluginSync');
                expect(error.hookName).toBe('onBeforeInsert');
                expect(error.originalError).toBeInstanceOf(Error);
                expect(error.originalError?.message).toBe('Intentional sync error in hook');
            }
        }
    });
});
