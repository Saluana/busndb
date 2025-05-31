import type { z } from 'zod';
import type { Row, CollectionSchema } from './types';
import { PluginError, PluginTimeoutError } from './errors';

export interface PluginContext {
    collectionName: string;
    schema: CollectionSchema;
    operation: string;
    data?: any;
    result?: any;
    error?: Error;
}

export interface PluginSystemOptions {
    timeout?: number; // Timeout in milliseconds, default 5000
}

export interface Plugin {
    name: string;
    version?: string;
    systemOptions?: PluginSystemOptions;
    
    // Lifecycle hooks
    onBeforeInsert?(context: PluginContext): Promise<void> | void;
    onAfterInsert?(context: PluginContext): Promise<void> | void;
    
    onBeforeUpdate?(context: PluginContext): Promise<void> | void;
    onAfterUpdate?(context: PluginContext): Promise<void> | void;
    
    onBeforeDelete?(context: PluginContext): Promise<void> | void;
    onAfterDelete?(context: PluginContext): Promise<void> | void;
    
    onBeforeQuery?(context: PluginContext): Promise<void> | void;
    onAfterQuery?(context: PluginContext): Promise<void> | void;
    
    onBeforeTransaction?(context: PluginContext): Promise<void> | void;
    onAfterTransaction?(context: PluginContext): Promise<void> | void;
    onTransactionError?(context: PluginContext): Promise<void> | void;
    
    // Database lifecycle
    onDatabaseInit?(context: Omit<PluginContext, 'collectionName' | 'schema'>): Promise<void> | void;
    onDatabaseClose?(context: Omit<PluginContext, 'collectionName' | 'schema'>): Promise<void> | void;
    
    // Collection lifecycle
    onCollectionCreate?(context: PluginContext): Promise<void> | void;
    onCollectionDrop?(context: PluginContext): Promise<void> | void;
    
    // Error handling
    onError?(context: PluginContext): Promise<void> | void;
}

export interface PluginManagerOptions {
    strictMode?: boolean; // If true, plugin errors are thrown as PluginErrors
    defaultTimeout?: number; // Default timeout for plugins in milliseconds
}

export class PluginManager {
    private plugins: Map<string, Plugin> = new Map();
    private hooks: Map<string, Plugin[]> = new Map();
    private options: PluginManagerOptions;
    
    constructor(options: PluginManagerOptions = {}) {
        this.options = {
            strictMode: false,
            defaultTimeout: 5000,
            ...options
        };
    }
    
    register(plugin: Plugin): void {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin '${plugin.name}' is already registered`);
        }
        
        this.plugins.set(plugin.name, plugin);
        
        // Register hooks - check both own properties and prototype methods
        const allKeys = new Set([
            ...Object.keys(plugin),
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(plugin))
        ]);
        
        allKeys.forEach(key => {
            if (key.startsWith('on') && typeof plugin[key as keyof Plugin] === 'function') {
                if (!this.hooks.has(key)) {
                    this.hooks.set(key, []);
                }
                this.hooks.get(key)!.push(plugin);
            }
        });
    }
    
    unregister(pluginName: string): void {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) {
            throw new Error(`Plugin '${pluginName}' is not registered`);
        }
        
        this.plugins.delete(pluginName);
        
        // Remove from hooks
        this.hooks.forEach((plugins, hookName) => {
            const index = plugins.indexOf(plugin);
            if (index !== -1) {
                plugins.splice(index, 1);
            }
        });
    }
    
    getPlugin(name: string): Plugin | undefined {
        return this.plugins.get(name);
    }
    
    listPlugins(): Plugin[] {
        return Array.from(this.plugins.values());
    }
    
    private async executeHookWithTimeout(
        plugin: Plugin, 
        hookName: string, 
        context: PluginContext
    ): Promise<void> {
        const hookFn = plugin[hookName as keyof Plugin] as Function;
        if (!hookFn) return;
        
        const timeout = plugin.systemOptions?.timeout ?? this.options.defaultTimeout!;
        
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new PluginTimeoutError(plugin.name, hookName, timeout));
            }, timeout);
            
            Promise.resolve(hookFn.call(plugin, context))
                .then(() => {
                    clearTimeout(timer);
                    resolve();
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }
    
    async executeHook(hookName: string, context: PluginContext): Promise<void> {
        const plugins = this.hooks.get(hookName) || [];
        
        for (const plugin of plugins) {
            try {
                await this.executeHookWithTimeout(plugin, hookName, context);
            } catch (error) {
                const pluginError = error instanceof PluginError 
                    ? error
                    : new PluginError(
                        `Plugin '${plugin.name}' hook '${hookName}' failed: ${(error as Error).message}`,
                        plugin.name,
                        hookName,
                        error as Error
                    );
                
                // If there's an error in a hook, try to call onError hooks
                if (hookName !== 'onError') {
                    try {
                        const errorContext = { ...context, error: pluginError };
                        await this.executeHook('onError', errorContext);
                    } catch {
                        // Ignore errors in onError hooks to prevent infinite loops
                    }
                }
                
                // Re-throw the error to maintain normal error flow
                throw pluginError;
            }
        }
    }
    
    async executeHookSafe(hookName: string, context: PluginContext): Promise<void> {
        try {
            await this.executeHook(hookName, context);
        } catch (error) {
            if (this.options.strictMode) {
                // In strict mode, throw PluginErrors
                throw error;
            } else {
                // Silent execution - don't let plugin errors break the main operation
                console.warn(`Plugin hook '${hookName}' failed:`, error);
            }
        }
    }
    
    setStrictMode(enabled: boolean): void {
        this.options.strictMode = enabled;
    }
    
    setDefaultTimeout(timeout: number): void {
        this.options.defaultTimeout = timeout;
    }
    
    getOptions(): PluginManagerOptions {
        return { ...this.options };
    }
}