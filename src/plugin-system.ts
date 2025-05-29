import type { z } from 'zod';
import type { Row, CollectionSchema } from './types';

export interface PluginContext {
    collectionName: string;
    schema: CollectionSchema;
    operation: string;
    data?: any;
    result?: any;
    error?: Error;
}

export interface Plugin {
    name: string;
    version?: string;
    
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

export class PluginManager {
    private plugins: Map<string, Plugin> = new Map();
    private hooks: Map<string, Plugin[]> = new Map();
    
    register(plugin: Plugin): void {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin '${plugin.name}' is already registered`);
        }
        
        this.plugins.set(plugin.name, plugin);
        
        // Register hooks
        Object.keys(plugin).forEach(key => {
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
    
    async executeHook(hookName: string, context: PluginContext): Promise<void> {
        const plugins = this.hooks.get(hookName) || [];
        
        for (const plugin of plugins) {
            try {
                const hookFn = plugin[hookName as keyof Plugin] as Function;
                if (hookFn) {
                    await hookFn.call(plugin, context);
                }
            } catch (error) {
                // If there's an error in a hook, try to call onError hooks
                if (hookName !== 'onError') {
                    const errorContext = { ...context, error: error as Error };
                    await this.executeHook('onError', errorContext);
                }
                // Re-throw the error to maintain normal error flow
                throw error;
            }
        }
    }
    
    async executeHookSafe(hookName: string, context: PluginContext): Promise<void> {
        try {
            await this.executeHook(hookName, context);
        } catch (error) {
            // Silent execution - don't let plugin errors break the main operation
            console.warn(`Plugin hook '${hookName}' failed:`, error);
        }
    }
}