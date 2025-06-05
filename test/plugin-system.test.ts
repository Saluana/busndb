import { test, expect, describe, beforeEach } from 'vitest';
import { PluginManager } from '../src/plugin-system';
import type { Plugin, PluginContext } from '../src/plugin-system';
import { PluginError, PluginTimeoutError } from '../src/errors'; // Corrected path for errors
import type { CollectionSchema } from '../src/types'; // Corrected path for CollectionSchema

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
                fields: [
                    {
                        name: '_id',
                        type: 'string',
                        unique: true,
                        primaryKey: true,
                    },
                ],
                primaryKey: '_id',
                indexes: [],
                constraints: [],
            } as unknown as CollectionSchema, // Using unknown to bypass strict CollectionSchema typing for tests
            operation: 'testOperation',
            data: { _id: 1, name: 'testData' },
            result: undefined,
            error: undefined,
        };
    });

    // Test cases will be added here

    test('registers and executes a hook defined directly on a plugin instance', async () => {
        (dummyContext as any).called = false;
        const instanceHookPlugin: Plugin = {
            name: 'InstanceHookPlugin',
            onCustomHook: (context: PluginContext) => {
                (context as any).called = true;
            },
        };
        pluginManager.register(instanceHookPlugin);
        await pluginManager.executeHook('onCustomHook', dummyContext);
        expect((dummyContext as any).called).toBe(true);
    });

    test('registers and executes a hook defined on a plugin\'s direct prototype', async () => {
        (dummyContext as any).called = false;
        class DirectProtoPlugin implements Plugin {
            name = 'TestDirectProto';
            onDirectProtoHook(context: PluginContext) {
                (context as any).called = true;
            }
        }
        const plugin = new DirectProtoPlugin();
        pluginManager.register(plugin);
        await pluginManager.executeHook('onDirectProtoHook', dummyContext);
        expect((dummyContext as any).called).toBe(true);
    });

    test('registers and executes a hook defined on a higher (grandparent) prototype', async () => {
        (dummyContext as any).grandBaseCalled = false;
        class GrandBasePlugin implements Partial<Plugin> { // Partial as name might not be on it
            onHigherHook(context: PluginContext) {
                (context as any).grandBaseCalled = true;
            }
        }
        class BasePlugin extends GrandBasePlugin implements Partial<Plugin> {}
        class MyPlugin extends BasePlugin implements Plugin {
            name = 'TestHigherProto';
        }
        const plugin = new MyPlugin();
        pluginManager.register(plugin);
        await pluginManager.executeHook('onHigherHook', dummyContext);
        expect((dummyContext as any).grandBaseCalled).toBe(true);
    });

    test('executes the overridden hook in a derived class', async () => {
        (dummyContext as any).hookVersion = '';
        class OverrideBasePlugin implements Partial<Plugin> {
            onOverrideHook(context: PluginContext) {
                (context as any).hookVersion = 'base';
            }
        }
        class OverrideDerivedPlugin extends OverrideBasePlugin implements Plugin {
            name = 'OverridePlugin';
            onOverrideHook(context: PluginContext) { // This overrides the base class method
                (context as any).hookVersion = 'derived';
            }
        }
        const plugin = new OverrideDerivedPlugin();
        pluginManager.register(plugin);
        await pluginManager.executeHook('onOverrideHook', dummyContext);
        expect((dummyContext as any).hookVersion).toBe('derived');
    });

    test('registers and executes a hook defined as a getter returning a function', async () => {
        (dummyContext as any).getterHookCalled = false;
        class GetterPlugin implements Plugin {
            name = 'GetterPlugin';
            get onGetterHook() {
                return (context: PluginContext) => {
                    (context as any).getterHookCalled = true;
                };
            }
        }
        const plugin = new GetterPlugin();
        pluginManager.register(plugin);
        await pluginManager.executeHook('onGetterHook', dummyContext);
        expect((dummyContext as any).getterHookCalled).toBe(true);
    });

    test('plugin hook is called only once even if discoverable at multiple prototype levels (implicitly tested by Set in discovery)', async () => {
        (dummyContext as any).callCount = 0;
        // This plugin structure is mostly for conceptual validation; the new discovery uses a Set for keys.
        // The main test is that the plugin (a single instance) is added to the hook's list once.
        const plugin: Plugin = {
            name: 'SingleCallPlugin',
            onSingleCallHook: (context: PluginContext) => {
                (context as any).callCount = ((context as any).callCount || 0) + 1;
            },
        };
        pluginManager.register(plugin);
        await pluginManager.executeHook('onSingleCallHook', dummyContext);
        expect((dummyContext as any).callCount).toBe(1);
    });

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
                expect(error.message).toBe(
                    "Plugin 'ErrorPluginSync' hook 'onBeforeInsert' threw synchronous error: Intentional sync error in hook"
                );
                expect(error.pluginName).toBe('ErrorPluginSync');
                expect(error.hookName).toBe('onBeforeInsert');
                expect(error.originalError).toBeInstanceOf(Error);
                expect(error.originalError?.message).toBe(
                    'Intentional sync error in hook'
                );
            }
        }
    });
});
