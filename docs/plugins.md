# BusNDB Plugin System

BusNDB provides a comprehensive plugin system that allows you to extend database functionality with custom behaviors, logging, caching, validation, and more. Plugins can hook into various database operations and lifecycle events.

## Table of Contents

- [Quick Start](#quick-start)
- [Plugin Lifecycle Hooks](#plugin-lifecycle-hooks)
- [Built-in Plugins](#built-in-plugins)
- [Creating Custom Plugins](#creating-custom-plugins)
- [Plugin Management](#plugin-management)
- [Best Practices](#best-practices)

## Quick Start

```typescript
import { 
    createDB, 
    AuditLogPlugin, 
    TimestampPlugin, 
    ValidationPlugin,
    validators 
} from 'busndb';

// Create database
const db = createDB({ path: './app.db' });

// Register plugins
db.use(new AuditLogPlugin())
  .use(new TimestampPlugin())
  .use(new ValidationPlugin()
    .addRule({
        field: 'email',
        validator: validators.email,
        message: 'Must be a valid email'
    })
  );

// Create collection - plugins will automatically apply
const users = db.collection('users', userSchema);
```

## Plugin Lifecycle Hooks

Plugins can implement any of these hooks to extend database functionality:

### CRUD Operation Hooks

```typescript
interface Plugin {
    // Insert operations
    onBeforeInsert?(context: PluginContext): Promise<void> | void;
    onAfterInsert?(context: PluginContext): Promise<void> | void;
    
    // Update operations  
    onBeforeUpdate?(context: PluginContext): Promise<void> | void;
    onAfterUpdate?(context: PluginContext): Promise<void> | void;
    
    // Delete operations
    onBeforeDelete?(context: PluginContext): Promise<void> | void;
    onAfterDelete?(context: PluginContext): Promise<void> | void;
    
    // Query operations
    onBeforeQuery?(context: PluginContext): Promise<void> | void;
    onAfterQuery?(context: PluginContext): Promise<void> | void;
}
```

### Database Lifecycle Hooks

```typescript
interface Plugin {
    // Database lifecycle
    onDatabaseInit?(context: PluginContext): Promise<void> | void;
    onDatabaseClose?(context: PluginContext): Promise<void> | void;
    
    // Collection lifecycle
    onCollectionCreate?(context: PluginContext): Promise<void> | void;
    onCollectionDrop?(context: PluginContext): Promise<void> | void;
    
    // Transaction lifecycle
    onBeforeTransaction?(context: PluginContext): Promise<void> | void;
    onAfterTransaction?(context: PluginContext): Promise<void> | void;
    onTransactionError?(context: PluginContext): Promise<void> | void;
    
    // Error handling
    onError?(context: PluginContext): Promise<void> | void;
}
```

### Plugin Context

The `PluginContext` provides information about the current operation:

```typescript
interface PluginContext {
    collectionName: string;    // Name of the collection
    schema: CollectionSchema;  // Collection schema definition
    operation: string;         // Operation type (insert, update, etc.)
    data?: any;               // Input data for the operation
    result?: any;             // Result data from the operation
    error?: Error;            // Error if operation failed
}
```

## Built-in Plugins

### AuditLogPlugin

Logs all database operations for auditing and debugging:

```typescript
import { AuditLogPlugin } from 'busndb';

const auditLog = new AuditLogPlugin({
    logInserts: true,
    logUpdates: true,
    logDeletes: true,
    logQueries: false,
    logLevel: 'info',
    customLogger: (level, message, context) => {
        console.log(`[${level}] ${message}`);
    }
});

db.use(auditLog);

// Output:
// [INFO] Document inserted: users:abc-123
// [INFO] Document updated: users:abc-123
```

### TimestampPlugin

Automatically adds created and updated timestamps:

```typescript
import { TimestampPlugin } from 'busndb';

const timestamp = new TimestampPlugin({
    createField: 'createdAt',  // Field for creation timestamp
    updateField: 'updatedAt',  // Field for update timestamp
    autoCreate: true,          // Auto-add on insert
    autoUpdate: true           // Auto-update on update
});

db.use(timestamp);

// Documents will automatically get createdAt and updatedAt fields
const user = collection.insert({ name: 'Alice' });
// user.createdAt and user.updatedAt are automatically set
```

### ValidationPlugin

Adds custom validation rules beyond Zod schema validation:

```typescript
import { ValidationPlugin, validators } from 'busndb';

const validation = new ValidationPlugin({ strictMode: true })
    .addRule({
        field: 'name',
        validator: validators.minLength(2),
        message: 'Name must be at least 2 characters'
    })
    .addRule({
        field: 'email',
        validator: validators.email,
        message: 'Must be a valid email'
    })
    .addRule({
        field: 'age',
        validator: validators.range(18, 120),
        message: 'Age must be between 18 and 120'
    });

db.use(validation);
```

**Built-in Validators:**
- `validators.required` - Field must have a value
- `validators.minLength(n)` - String minimum length
- `validators.maxLength(n)` - String maximum length  
- `validators.email` - Valid email format
- `validators.url` - Valid URL format
- `validators.range(min, max)` - Number within range
- `validators.pattern(regex)` - Matches regex pattern
- `validators.custom(fn)` - Custom validation function

### CachePlugin

Provides in-memory caching for better performance:

```typescript
import { CachePlugin } from 'busndb';

const cache = new CachePlugin({
    maxSize: 1000,                  // Maximum cached items
    ttl: 60000,                     // Cache TTL in milliseconds
    enableDocumentCache: true,       // Cache individual documents
    enableQueryCache: false          // Cache query results (complex)
});

db.use(cache);

// Access cache directly
const cachedDoc = cache.getCachedDocument('users', 'user-id');
cache.invalidateCollection('users');
cache.clearCache();
```

### MetricsPlugin

Tracks operation metrics and performance:

```typescript
import { MetricsPlugin } from 'busndb';

const metrics = new MetricsPlugin({
    trackOperations: true,    // Count operations
    trackPerformance: true,   // Measure execution time
    trackErrors: true,        // Count errors
    resetInterval: 3600000    // Reset every hour (0 = never)
});

db.use(metrics);

// Access metrics
const summary = metrics.getSummary();
console.log(`Total operations: ${summary.totalOperations}`);
console.log(`Total errors: ${summary.totalErrors}`);

const userMetrics = metrics.getMetrics('users');
console.log(`Avg insert time: ${userMetrics.inserts.avgTime}ms`);
```

## Creating Custom Plugins

### Simple Plugin Example

```typescript
import type { Plugin, PluginContext } from 'busndb';

class SimpleLoggerPlugin implements Plugin {
    name = 'simple-logger';
    version = '1.0.0';
    
    async onAfterInsert(context: PluginContext): Promise<void> {
        console.log(`New document in ${context.collectionName}:`, context.result?.id);
    }
    
    async onError(context: PluginContext): Promise<void> {
        console.error(`Error in ${context.operation}:`, context.error?.message);
    }
}

// Use the plugin
db.use(new SimpleLoggerPlugin());
```

### Advanced Plugin with Configuration

```typescript
interface NotificationOptions {
    webhookUrl?: string;
    emailRecipient?: string;
    enableInsertNotifications?: boolean;
    enableErrorNotifications?: boolean;
}

class NotificationPlugin implements Plugin {
    name = 'notification';
    version = '1.0.0';
    
    private options: Required<NotificationOptions>;
    
    constructor(options: NotificationOptions = {}) {
        this.options = {
            webhookUrl: '',
            emailRecipient: '',
            enableInsertNotifications: false,
            enableErrorNotifications: true,
            ...options
        };
    }
    
    async onAfterInsert(context: PluginContext): Promise<void> {
        if (this.options.enableInsertNotifications) {
            await this.sendNotification(
                `New ${context.collectionName} created`,
                context.result
            );
        }
    }
    
    async onError(context: PluginContext): Promise<void> {
        if (this.options.enableErrorNotifications) {
            await this.sendNotification(
                `Database error in ${context.operation}`,
                { error: context.error?.message, collection: context.collectionName }
            );
        }
    }
    
    private async sendNotification(message: string, data: any): Promise<void> {
        if (this.options.webhookUrl) {
            // Send webhook notification
            try {
                await fetch(this.options.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, data, timestamp: new Date() })
                });
            } catch (error) {
                console.warn('Failed to send webhook notification:', error);
            }
        }
        
        // Could also implement email notifications here
    }
}

// Use with configuration
db.use(new NotificationPlugin({
    webhookUrl: 'https://hooks.slack.com/services/...',
    enableInsertNotifications: true,
    enableErrorNotifications: true
}));
```

### Plugin with State Management

```typescript
class StatisticsPlugin implements Plugin {
    name = 'statistics';
    version = '1.0.0';
    
    private stats = {
        totalOperations: 0,
        operationsByCollection: new Map<string, number>(),
        errorsByCollection: new Map<string, number>()
    };
    
    async onAfterInsert(context: PluginContext): Promise<void> {
        this.incrementStats(context.collectionName);
    }
    
    async onAfterUpdate(context: PluginContext): Promise<void> {
        this.incrementStats(context.collectionName);
    }
    
    async onAfterDelete(context: PluginContext): Promise<void> {
        this.incrementStats(context.collectionName);
    }
    
    async onError(context: PluginContext): Promise<void> {
        const current = this.stats.errorsByCollection.get(context.collectionName) || 0;
        this.stats.errorsByCollection.set(context.collectionName, current + 1);
    }
    
    private incrementStats(collectionName: string): void {
        this.stats.totalOperations++;
        const current = this.stats.operationsByCollection.get(collectionName) || 0;
        this.stats.operationsByCollection.set(collectionName, current + 1);
    }
    
    getStats() {
        return {
            totalOperations: this.stats.totalOperations,
            byCollection: Object.fromEntries(this.stats.operationsByCollection),
            errorsByCollection: Object.fromEntries(this.stats.errorsByCollection)
        };
    }
    
    resetStats(): void {
        this.stats.totalOperations = 0;
        this.stats.operationsByCollection.clear();
        this.stats.errorsByCollection.clear();
    }
}
```

## Plugin Management

### Registering Plugins

```typescript
// Method chaining
db.use(plugin1).use(plugin2).use(plugin3);

// Individual registration
db.use(new AuditLogPlugin());
db.use(new TimestampPlugin());
```

### Accessing Plugins

```typescript
// Get specific plugin
const auditPlugin = db.getPlugin('audit-log') as AuditLogPlugin;

// List all plugins
const allPlugins = db.listPlugins();
console.log('Registered plugins:', allPlugins.map(p => p.name));
```

### Removing Plugins

```typescript
// Remove by name
db.unuse('audit-log');

// Verify removal
console.log('Remaining plugins:', db.listPlugins().map(p => p.name));
```

### Plugin Execution Order

Plugins execute in the order they were registered:

```typescript
// First registered = first executed
db.use(timestampPlugin)    // Executes first
  .use(validationPlugin)   // Executes second  
  .use(auditLogPlugin);    // Executes last
```

## Best Practices

### 1. Plugin Naming

Use descriptive, unique names for your plugins:

```typescript
class MyPlugin implements Plugin {
    name = 'my-company-audit-log';  // Good: specific and unique
    version = '1.0.0';
}
```

### 2. Error Handling

Always handle errors gracefully in plugins:

```typescript
async onAfterInsert(context: PluginContext): Promise<void> {
    try {
        await this.sendNotification(context);
    } catch (error) {
        // Log but don't throw - don't break the main operation
        console.warn('Plugin notification failed:', error);
    }
}
```

### 3. Performance Considerations

- Keep plugin logic lightweight
- Use async operations only when necessary
- Consider using `executeHookSafe` for non-critical operations

```typescript
// Plugin hooks are non-blocking by default
async onAfterInsert(context: PluginContext): Promise<void> {
    // This won't block the main insert operation
    await this.heavyAsyncOperation(context);
}
```

### 4. Configuration Validation

Validate plugin configuration at initialization:

```typescript
constructor(options: MyPluginOptions = {}) {
    if (options.apiKey && !options.apiUrl) {
        throw new Error('API URL required when API key is provided');
    }
    this.options = { ...defaultOptions, ...options };
}
```

### 5. Cleanup Resources

Implement cleanup for plugins with resources:

```typescript
class ResourcefulPlugin implements Plugin {
    private interval?: NodeJS.Timeout;
    
    constructor() {
        this.interval = setInterval(() => this.cleanup(), 60000);
    }
    
    async onDatabaseClose(): Promise<void> {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}
```

### 6. Testing Plugins

Test plugins independently:

```typescript
// Test plugin hooks directly
const plugin = new MyPlugin();
const mockContext = {
    collectionName: 'test',
    schema: mockSchema,
    operation: 'insert',
    data: { id: '123', name: 'test' }
};

await plugin.onBeforeInsert(mockContext);
// Verify plugin behavior
```

## Plugin Development Tips

### Data Modification

Plugins can modify context data in "before" hooks:

```typescript
async onBeforeInsert(context: PluginContext): Promise<void> {
    if (context.data) {
        // Add timestamp
        context.data.processedAt = new Date().toISOString();
        
        // Normalize data
        context.data.email = context.data.email?.toLowerCase();
    }
}
```

### Conditional Logic

Use context information for conditional behavior:

```typescript
async onAfterInsert(context: PluginContext): Promise<void> {
    // Only log inserts for specific collections
    if (context.collectionName === 'users') {
        this.logUserCreation(context.result);
    }
}
```

### Plugin Communication

Plugins can communicate through shared state or events:

```typescript
// Plugin 1 sets metadata
async onAfterInsert(context: PluginContext): Promise<void> {
    context.data._pluginMetadata = { processedBy: this.name };
}

// Plugin 2 reads metadata
async onAfterInsert(context: PluginContext): Promise<void> {
    if (context.data._pluginMetadata) {
        console.log('Processed by:', context.data._pluginMetadata.processedBy);
    }
}
```

The plugin system provides a powerful way to extend BusNDB's functionality while maintaining clean separation of concerns and performance.