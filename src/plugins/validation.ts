import type { Plugin, PluginContext } from '../plugin-system';

export interface ValidationRule {
    field: string;
    validator: (value: any, document: any, context: PluginContext) => boolean | string;
    message?: string;
}

export interface ValidationOptions {
    rules?: ValidationRule[];
    strictMode?: boolean; // Throw errors vs log warnings
}

export class ValidationPlugin implements Plugin {
    name = 'validation';
    version = '1.0.0';
    
    private options: Required<ValidationOptions>;
    
    constructor(options: ValidationOptions = {}) {
        this.options = {
            rules: [],
            strictMode: true,
            ...options
        };
    }
    
    addRule(rule: ValidationRule): this {
        this.options.rules.push(rule);
        return this;
    }
    
    private validateDocument(document: any, context: PluginContext): void {
        for (const rule of this.options.rules) {
            const fieldValue = this.getFieldValue(document, rule.field);
            const result = rule.validator(fieldValue, document, context);
            
            if (result !== true) {
                const message = typeof result === 'string' ? result : rule.message || `Validation failed for field ${rule.field}`;
                
                if (this.options.strictMode) {
                    throw new Error(`Validation Error: ${message}`);
                } else {
                    console.warn(`Validation Warning: ${message}`, {
                        collection: context.collectionName,
                        field: rule.field,
                        value: fieldValue
                    });
                }
            }
        }
    }
    
    private getFieldValue(document: any, fieldPath: string): any {
        return fieldPath.split('.').reduce((obj, key) => obj?.[key], document);
    }
    
    async onBeforeInsert(context: PluginContext): Promise<void> {
        if (context.data && this.options.rules.length > 0) {
            this.validateDocument(context.data, context);
        }
    }
    
    async onBeforeUpdate(context: PluginContext): Promise<void> {
        if (context.data && this.options.rules.length > 0) {
            this.validateDocument(context.data, context);
        }
    }
}

// Predefined validators
export const validators = {
    required: (value: any) => value != null && value !== '',
    
    minLength: (min: number) => (value: string) => 
        typeof value === 'string' && value.length >= min,
    
    maxLength: (max: number) => (value: string) => 
        typeof value === 'string' && value.length <= max,
    
    email: (value: string) => 
        typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    
    url: (value: string) => {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    },
    
    range: (min: number, max: number) => (value: number) => 
        typeof value === 'number' && value >= min && value <= max,
    
    pattern: (regex: RegExp) => (value: string) => 
        typeof value === 'string' && regex.test(value),
    
    custom: (fn: (value: any) => boolean) => fn
};