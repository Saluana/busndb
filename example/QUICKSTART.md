# Todo CLI - Quick Start Guide

A production-ready todo list CLI application built with BusNDB, demonstrating real-world database usage with persistent storage.

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd example
bun install

# 2. Run the demo
./demo.sh

# 3. Or start using the CLI directly
bun run todo.ts help
```

## 📝 Basic Usage

```bash
# Add a new todo
bun run todo.ts add "Complete project documentation"

# Add with options
bun run todo.ts add "Team meeting" --priority high --due 2024-12-25 --description "Quarterly review"

# List todos
bun run todo.ts list
bun run todo.ts list --pending
bun run todo.ts list --priority high

# Complete a todo
bun run todo.ts toggle <todo-id>

# Update a todo
bun run todo.ts update <todo-id> --title "New title" --priority medium

# Delete a todo
bun run todo.ts delete <todo-id>

# View statistics
bun run todo.ts stats
```

## 💾 Database Features

- **Persistent Storage**: SQLite database at `example/todos.db`
- **Schema Constraints**: Optimized field types and constraints
- **ACID Transactions**: Reliable data integrity
- **Performance**: Indexed queries for fast filtering and sorting

## 🔍 What This Demonstrates

### 1. Real-World Database Usage
- Persistent SQLite database (not in-memory)
- Production-ready schema with constraints
- Error handling and data validation

### 2. BusNDB Features
- Zod schema integration
- Constrained fields for optimization
- Query builder with filtering and sorting
- CRUD operations with type safety

### 3. Advanced Querying
```typescript
// Filter by completion status
const pending = await todos.where('completed').eq(false).toArray();

// Filter by priority
const highPriority = await todos.where('priority').eq('high').toArray();

// Combined filters with sorting
const urgentTodos = await todos
  .where('priority').eq('high')
  .where('completed').eq(false)
  .orderBy('createdAt', 'desc')
  .toArray();
```

### 4. Schema with Constraints
```typescript
const todos = db.collection('todos', todoSchema, {
  constrainedFields: {
    title: { nullable: false, type: 'TEXT' },
    completed: { nullable: false, type: 'INTEGER' },
    priority: { nullable: false, type: 'TEXT' },
    createdAt: { nullable: false, type: 'TEXT' },
    updatedAt: { nullable: false, type: 'TEXT' },
  },
});
```

## 🏗️ Architecture

```
example/
├── todo.ts           # Main CLI application
├── todos.db          # SQLite database (created automatically)
├── package.json      # Dependencies and scripts
├── demo.sh          # Interactive demonstration
└── README.md        # Comprehensive documentation
```

## 🎯 Key Features Showcased

1. **CLI Interface**: Professional command-line tool with colored output
2. **Data Persistence**: Real database storage with SQLite
3. **Schema Validation**: Zod schema with database constraints
4. **Query Optimization**: Indexed fields for performance
5. **Error Handling**: Comprehensive error management
6. **Type Safety**: Full TypeScript integration
7. **User Experience**: Rich formatting and helpful messages

## 📊 Performance

The application demonstrates BusNDB's performance features:
- Automatic indexing on constrained fields
- Optimized SQLite queries with type hints
- Efficient filtering and sorting operations
- Fast CRUD operations even with large datasets

## 🔧 Customization

You can easily extend this example:
- Add more fields to the todo schema
- Implement categories or tags
- Add search functionality
- Create todo templates
- Export/import features

## 💡 Best Practices Demonstrated

1. **Schema Design**: Proper field types and constraints
2. **Error Handling**: Try-catch blocks with user-friendly messages
3. **Database Cleanup**: Proper connection management
4. **Input Validation**: Command-line argument parsing and validation
5. **User Experience**: Colored output and clear feedback

This example serves as a solid foundation for building production applications with BusNDB!