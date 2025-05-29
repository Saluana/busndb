# Todo CLI Example

A comprehensive todo list CLI application demonstrating BusNDB usage with persistent storage, CRUD operations, and advanced querying features.

## Features

- ✅ **Create** todos with title, description, priority, and due dates
- 📋 **List** todos with filtering and sorting options
- ✏️ **Update** existing todos
- 🔄 **Toggle** completion status
- 🗑️ **Delete** todos
- 📊 **Statistics** and progress tracking
- 💾 **Persistent storage** using SQLite database
- 🎨 **Colorized output** for better user experience
- ⚡ **Fast performance** with BusNDB optimizations

## Installation

```bash
cd example
bun install
```

## Usage

### Basic Commands

```bash
# Show help
bun run todo.ts help

# Add a new todo
bun run todo.ts add "Buy groceries"

# Add a todo with options
bun run todo.ts add "Team meeting" --priority high --due 2024-12-25 --description "Discuss project roadmap"

# List all todos
bun run todo.ts list

# List only pending todos
bun run todo.ts list --pending

# List only completed todos
bun run todo.ts list --completed

# List todos by priority
bun run todo.ts list --priority high

# Update a todo
bun run todo.ts update <todo-id> --title "New title" --completed true

# Toggle completion status
bun run todo.ts toggle <todo-id>

# Delete a todo
bun run todo.ts delete <todo-id>

# Show statistics
bun run todo.ts stats
```

### Advanced Examples

```bash
# Create a high-priority todo with due date
bun run todo.ts add "Submit report" --priority high --due 2024-12-31 --description "Annual performance review"

# List high-priority pending todos
bun run todo.ts list --pending --priority high

# Update multiple fields
bun run todo.ts update abc-123-def --title "Updated title" --priority medium --completed false

# Sort by different fields
bun run todo.ts list --sort priority
bun run todo.ts list --sort dueDate
```

## Database Schema

The application uses a robust schema with the following constraints:

```typescript
const todoSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, 'Title cannot be empty'),
  description: z.string().optional(),
  completed: z.boolean().default(false),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
  dueDate: z.date().optional(),
});

// Database constraints for optimization
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

## Key Features Demonstrated

### 1. Persistent Storage
- Database file stored at `example/todos.db`
- Data persists between application runs
- SQLite backend for reliability

### 2. Schema Constraints
- Non-nullable fields for required data
- Type optimization for better performance
- Validation at both Zod and database levels

### 3. CRUD Operations
- **Create**: Insert new todos with validation
- **Read**: Query with filtering, sorting, and pagination
- **Update**: Partial updates with automatic timestamp tracking
- **Delete**: Safe deletion with existence checks

### 4. Advanced Querying
- Filter by completion status
- Filter by priority level
- Sort by various fields (created, updated, priority, due date)
- Count and statistics queries

### 5. Error Handling
- Comprehensive try-catch blocks
- User-friendly error messages
- Input validation and sanitization

### 6. User Experience
- Colorized terminal output
- Progress indicators and icons
- Formatted dates and statistics
- Helpful command documentation

## Database File Location

The SQLite database is created at:
```
example/todos.db
```

This ensures data persistence across application restarts. You can inspect the database using any SQLite browser or CLI tools.

## Performance Features

- **Indexed Queries**: Automatic indexing on constrained fields
- **Type Optimization**: SQLite type hints for better performance
- **Efficient Filtering**: Optimized WHERE clauses
- **Batch Operations**: Support for bulk operations when needed

## Example Output

```bash
$ bun run todo.ts add "Learn BusNDB" --priority high --due 2024-12-31
✅ Todo created successfully!
   ID: 550e8400-e29b-41d4-a716-446655440000
   Title: Learn BusNDB
   Priority: high
   Due: Dec 31, 2024, 11:59 PM

$ bun run todo.ts list
📋 Found 1 todo(s):

1. ⭕ Learn BusNDB
   ID: 550e8400-e29b-41d4-a716-446655440000
   Priority: 🔴 high
   Created: Dec 15, 2024, 10:30 AM
   Due: Dec 31, 2024, 11:59 PM

$ bun run todo.ts stats
📊 Todo Statistics:

   Total Todos: 1
   ✅ Completed: 0
   ⭕ Pending: 1
   🔴 High Priority: 1
   📈 Completion Rate: 0.0%
```

## Architecture Highlights

This example demonstrates several BusNDB features:

1. **Schema Definition**: Using Zod for runtime validation
2. **Collection Configuration**: Constraint fields for optimization
3. **Query Builder**: Fluent API for complex queries
4. **Type Safety**: Full TypeScript integration
5. **Error Handling**: Graceful error management
6. **Performance**: Optimized queries and indexing

The application serves as a practical example of building real-world applications with BusNDB, showcasing both basic CRUD operations and advanced database features.