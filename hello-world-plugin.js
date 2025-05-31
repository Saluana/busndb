// Hello World Plugin Example
// This demonstrates different ways to create plugins for skibbaDB

// Example 1: Plugin Class
class HelloWorldPlugin {
    constructor(options = {}) {
        this.name = options.name || 'hello-world';
        this.message = options.message || 'Hello from plugin!';
        this.logLevel = options.logLevel || 'info';
    }

    async onAfterInsert(context) {
        this.log(`${this.message} Document inserted in ${context.collectionName}: ${context.result?.id}`);
    }

    async onAfterUpdate(context) {
        this.log(`${this.message} Document updated in ${context.collectionName}: ${context.result?.id}`);
    }

    async onAfterDelete(context) {
        this.log(`${this.message} Document deleted from ${context.collectionName}`);
    }

    async onBeforeQuery(context) {
        this.log(`${this.message} Querying ${context.collectionName}`);
    }

    log(message) {
        if (this.logLevel === 'info') {
            console.log(`[HelloWorld] ${message}`);
        }
    }
}

// Example 2: Plugin Factory Function
function createHelloWorldPlugin(options = {}) {
    return new HelloWorldPlugin(options);
}

// Example 3: Plugin Instance
const helloWorldInstance = new HelloWorldPlugin({ 
    name: 'hello-world-instance',
    message: 'Greetings!', 
    logLevel: 'info' 
});

// Export different formats to test
module.exports = {
    // For testing class usage
    HelloWorldPlugin,
    
    // For testing factory usage
    createHelloWorldPlugin,
    
    // For testing instance usage
    helloWorldInstance,
    
    // Default export as class (most common pattern)
    default: HelloWorldPlugin
};