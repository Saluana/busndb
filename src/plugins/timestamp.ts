import type { Plugin, PluginContext } from '../plugin-system';

export interface TimestampOptions {
    createField?: string;
    updateField?: string;
    autoCreate?: boolean;
    autoUpdate?: boolean;
}

export class TimestampPlugin implements Plugin {
    name = 'timestamp';
    version = '1.0.0';
    
    private options: Required<TimestampOptions>;
    
    constructor(options: TimestampOptions = {}) {
        this.options = {
            createField: 'createdAt',
            updateField: 'updatedAt',
            autoCreate: true,
            autoUpdate: true,
            ...options
        };
    }
    
    async onBeforeInsert(context: PluginContext): Promise<void> {
        if (this.options.autoCreate && context.data) {
            const now = new Date().toISOString();
            
            // Add createdAt if not present
            if (!context.data[this.options.createField]) {
                context.data[this.options.createField] = now;
            }
            
            // Add updatedAt if not present
            if (!context.data[this.options.updateField]) {
                context.data[this.options.updateField] = now;
            }
        }
    }
    
    async onBeforeUpdate(context: PluginContext): Promise<void> {
        if (this.options.autoUpdate && context.data) {
            const now = new Date().toISOString();
            
            // Always update the updatedAt field
            context.data[this.options.updateField] = now;
        }
    }
}