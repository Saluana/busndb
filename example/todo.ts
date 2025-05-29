#!/usr/bin/env bun

import { z } from 'zod';
import { createDB } from '../src/index.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Todo schema definition
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

type Todo = z.infer<typeof todoSchema>;

// Database setup with persistent storage
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, 'todos.db');
const db = createDB({ path: DB_PATH });

// Create todos collection with constraints
type ConstrainedField = { nullable: boolean; type: string };

const todos = db.collection('todos', todoSchema, {
    constrainedFields: {
        title: {
            nullable: false,
            type: 'TEXT',
            unique: true,
        } as ConstrainedField,
        completed: { nullable: false, type: 'INTEGER' } as ConstrainedField, // SQLite stores booleans as integers
        priority: { nullable: false, type: 'TEXT' } as ConstrainedField,
        createdAt: { nullable: false, type: 'TEXT' } as ConstrainedField, // ISO string format
        updatedAt: { nullable: false, type: 'TEXT' } as ConstrainedField,
    },
});

// CLI Colors for better UX
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

// Helper functions
function colorize(text: string, color: keyof typeof colors): string {
    return `${colors[color]}${text}${colors.reset}`;
}

function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function priorityColor(priority: string): keyof typeof colors {
    switch (priority) {
        case 'high':
            return 'red';
        case 'medium':
            return 'yellow';
        case 'low':
            return 'green';
        default:
            return 'reset';
    }
}

// CRUD Operations
class TodoCLI {
    // Create a new todo
    async create(
        title: string,
        options: {
            description?: string;
            priority?: 'low' | 'medium' | 'high';
            dueDate?: string;
        } = {}
    ) {
        try {
            const todoData: Partial<Todo> = {
                title: title.trim(),
                description: options.description?.trim(),
                priority: options.priority || 'medium',
            };

            if (options.dueDate) {
                const dueDate = new Date(options.dueDate);
                if (isNaN(dueDate.getTime())) {
                    console.log(
                        colorize(
                            '❌ Invalid due date format. Use YYYY-MM-DD or MM/DD/YYYY',
                            'red'
                        )
                    );
                    return;
                }
                todoData.dueDate = dueDate;
            }

            const newTodo = await todos.insert(todoData);
            console.log(colorize('✅ Todo created successfully!', 'green'));
            console.log(`   ID: ${colorize(newTodo.id!, 'cyan')}`);
            console.log(`   Title: ${colorize(newTodo.title, 'bright')}`);
            if (newTodo.description) {
                console.log(`   Description: ${newTodo.description}`);
            }
            console.log(
                `   Priority: ${colorize(
                    newTodo.priority,
                    priorityColor(newTodo.priority)
                )}`
            );
            if (newTodo.dueDate) {
                console.log(
                    `   Due: ${colorize(formatDate(newTodo.dueDate), 'yellow')}`
                );
            }
        } catch (error) {
            console.log(colorize(`❌ Error creating todo: ${error}`, 'red'));
        }
    }

    // List all todos with optional filtering
    async list(
        options: {
            completed?: boolean;
            priority?: 'low' | 'medium' | 'high';
            sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'dueDate';
        } = {}
    ) {
        try {
            let query = todos;

            // Apply filters
            if (options.completed !== undefined) {
                query = query.where('completed').eq(options.completed);
            }
            if (options.priority) {
                query = query.where('priority').eq(options.priority);
            }

            // Apply sorting
            const sortField = options.sortBy || 'createdAt';
            query = query.orderBy(sortField, 'desc');

            const todoList = await query.toArray();

            if (todoList.length === 0) {
                console.log(colorize('📝 No todos found!', 'yellow'));
                return;
            }

            console.log(
                colorize(`\n📋 Found ${todoList.length} todo(s):\n`, 'bright')
            );

            todoList.forEach((todo, index) => {
                const status = todo.completed ? '✅' : '⭕';
                const priorityIcon =
                    todo.priority === 'high'
                        ? '🔴'
                        : todo.priority === 'medium'
                        ? '🟡'
                        : '🟢';

                console.log(
                    `${index + 1}. ${status} ${colorize(todo.title, 'bright')}`
                );
                console.log(`   ID: ${colorize(todo.id!, 'cyan')}`);
                if (todo.description) {
                    console.log(`   Description: ${todo.description}`);
                }
                console.log(
                    `   Priority: ${priorityIcon} ${colorize(
                        todo.priority,
                        priorityColor(todo.priority)
                    )}`
                );
                console.log(
                    `   Created: ${colorize(
                        formatDate(todo.createdAt),
                        'blue'
                    )}`
                );
                if (todo.updatedAt.getTime() !== todo.createdAt.getTime()) {
                    console.log(
                        `   Updated: ${colorize(
                            formatDate(todo.updatedAt),
                            'blue'
                        )}`
                    );
                }
                if (todo.dueDate) {
                    const isOverdue =
                        todo.dueDate < new Date() && !todo.completed;
                    const dueDateColor = isOverdue ? 'red' : 'yellow';
                    const overdueIcon = isOverdue ? '⚠️ ' : '';
                    console.log(
                        `   Due: ${overdueIcon}${colorize(
                            formatDate(todo.dueDate),
                            dueDateColor
                        )}`
                    );
                }
                console.log('');
            });
        } catch (error) {
            console.log(colorize(`❌ Error listing todos: ${error}`, 'red'));
        }
    }

    // Update a todo
    async update(
        id: string,
        updates: {
            title?: string;
            description?: string;
            completed?: boolean;
            priority?: 'low' | 'medium' | 'high';
            dueDate?: string;
        }
    ) {
        try {
            const existingTodo = await todos.findById(id);
            if (!existingTodo) {
                console.log(colorize('❌ Todo not found!', 'red'));
                return;
            }

            const updateData: Partial<Todo> = {
                updatedAt: new Date(),
            };

            if (updates.title !== undefined) {
                updateData.title = updates.title.trim();
            }
            if (updates.description !== undefined) {
                updateData.description = updates.description.trim();
            }
            if (updates.completed !== undefined) {
                updateData.completed = updates.completed;
            }
            if (updates.priority !== undefined) {
                updateData.priority = updates.priority;
            }
            if (updates.dueDate !== undefined) {
                const dueDate = new Date(updates.dueDate);
                if (isNaN(dueDate.getTime())) {
                    console.log(
                        colorize(
                            '❌ Invalid due date format. Use YYYY-MM-DD or MM/DD/YYYY',
                            'red'
                        )
                    );
                    return;
                }
                updateData.dueDate = dueDate;
            }

            const updatedTodo = await todos.put(id, updateData);
            console.log(colorize('✅ Todo updated successfully!', 'green'));
            console.log(`   Title: ${colorize(updatedTodo.title, 'bright')}`);
            console.log(
                `   Status: ${
                    updatedTodo.completed ? '✅ Completed' : '⭕ Pending'
                }`
            );
            console.log(
                `   Priority: ${colorize(
                    updatedTodo.priority,
                    priorityColor(updatedTodo.priority)
                )}`
            );
            console.log(
                `   Updated: ${colorize(
                    formatDate(updatedTodo.updatedAt),
                    'blue'
                )}`
            );
        } catch (error) {
            console.log(colorize(`❌ Error updating todo: ${error}`, 'red'));
        }
    }

    // Mark todo as complete/incomplete
    async toggle(id: string) {
        try {
            const existingTodo = await todos.findById(id);
            if (!existingTodo) {
                console.log(colorize('❌ Todo not found!', 'red'));
                return;
            }

            const updatedTodo = await todos.put(id, {
                completed: !existingTodo.completed,
                updatedAt: new Date(),
            });

            const status = updatedTodo.completed ? 'completed' : 'reopened';
            const icon = updatedTodo.completed ? '✅' : '⭕';
            console.log(colorize(`${icon} Todo ${status}!`, 'green'));
            console.log(`   ${colorize(updatedTodo.title, 'bright')}`);
        } catch (error) {
            console.log(colorize(`❌ Error toggling todo: ${error}`, 'red'));
        }
    }

    // Delete a todo
    async delete(id: string) {
        try {
            const existingTodo = await todos.findById(id);
            if (!existingTodo) {
                console.log(colorize('❌ Todo not found!', 'red'));
                return;
            }

            await todos.delete(id);
            console.log(colorize('🗑️ Todo deleted successfully!', 'green'));
            console.log(`   ${colorize(existingTodo.title, 'bright')}`);
        } catch (error) {
            console.log(colorize(`❌ Error deleting todo: ${error}`, 'red'));
        }
    }

    // Get statistics
    async stats() {
        try {
            const allTodos = await todos.toArray();
            const completed = await todos.where('completed').eq(true).count();
            const pending = await todos.where('completed').eq(false).count();
            const highPriority = await todos
                .where('priority')
                .eq('high')
                .count();

            // Get overdue todos
            const overdue = allTodos.filter(
                (todo) =>
                    todo.dueDate && todo.dueDate < new Date() && !todo.completed
            ).length;

            console.log(colorize('\n📊 Todo Statistics:\n', 'bright'));
            console.log(
                `   Total Todos: ${colorize(
                    allTodos.length.toString(),
                    'cyan'
                )}`
            );
            console.log(
                `   ✅ Completed: ${colorize(completed.toString(), 'green')}`
            );
            console.log(
                `   ⭕ Pending: ${colorize(pending.toString(), 'yellow')}`
            );
            console.log(
                `   🔴 High Priority: ${colorize(
                    highPriority.toString(),
                    'red'
                )}`
            );
            if (overdue > 0) {
                console.log(
                    `   ⚠️ Overdue: ${colorize(overdue.toString(), 'red')}`
                );
            }

            const completionRate =
                allTodos.length > 0
                    ? ((completed / allTodos.length) * 100).toFixed(1)
                    : '0';
            console.log(
                `   📈 Completion Rate: ${colorize(
                    `${completionRate}%`,
                    'blue'
                )}`
            );
        } catch (error) {
            console.log(
                colorize(`❌ Error getting statistics: ${error}`, 'red')
            );
        }
    }

    // Show help
    showHelp() {
        console.log(colorize('\n📝 Todo CLI - Help\n', 'bright'));
        console.log('Usage: bun run todo.ts <command> [options]\n');

        console.log(colorize('Commands:', 'cyan'));
        console.log('  add <title>               Add a new todo');
        console.log('  list                      List all todos');
        console.log('  list --completed          List completed todos');
        console.log('  list --pending            List pending todos');
        console.log(
            '  list --priority <level>   List todos by priority (low|medium|high)'
        );
        console.log('  update <id>               Update a todo');
        console.log(
            '  toggle <id>               Toggle todo completion status'
        );
        console.log('  delete <id>               Delete a todo');
        console.log('  stats                     Show todo statistics');
        console.log('  help                      Show this help message\n');

        console.log(colorize('Examples:', 'yellow'));
        console.log('  bun run todo.ts add "Buy groceries"');
        console.log(
            '  bun run todo.ts add "Meeting with team" --priority high --due 2024-12-25'
        );
        console.log('  bun run todo.ts list --pending');
        console.log('  bun run todo.ts toggle abc-123-def');
        console.log('  bun run todo.ts update abc-123-def --completed true');
        console.log('');
    }
}

// CLI argument parsing and main execution
async function main() {
    const cli = new TodoCLI();
    const args = process.argv.slice(2);

    if (args.length === 0) {
        cli.showHelp();
        return;
    }

    const command = args[0];

    try {
        switch (command) {
            case 'add':
                if (args.length < 2) {
                    console.log(
                        colorize(
                            '❌ Please provide a title for the todo',
                            'red'
                        )
                    );
                    return;
                }

                const title = args[1];
                const options: any = {};

                // Parse options
                for (let i = 2; i < args.length; i += 2) {
                    const flag = args[i];
                    const value = args[i + 1];

                    switch (flag) {
                        case '--description':
                            options.description = value;
                            break;
                        case '--priority':
                            if (['low', 'medium', 'high'].includes(value)) {
                                options.priority = value;
                            }
                            break;
                        case '--due':
                            options.dueDate = value;
                            break;
                    }
                }

                await cli.create(title, options);
                break;

            case 'list':
                const listOptions: any = {};

                if (args.includes('--completed')) {
                    listOptions.completed = true;
                } else if (args.includes('--pending')) {
                    listOptions.completed = false;
                }

                const priorityIndex = args.indexOf('--priority');
                if (priorityIndex !== -1 && args[priorityIndex + 1]) {
                    const priority = args[priorityIndex + 1];
                    if (['low', 'medium', 'high'].includes(priority)) {
                        listOptions.priority = priority;
                    }
                }

                const sortIndex = args.indexOf('--sort');
                if (sortIndex !== -1 && args[sortIndex + 1]) {
                    const sortBy = args[sortIndex + 1];
                    if (
                        [
                            'createdAt',
                            'updatedAt',
                            'priority',
                            'dueDate',
                        ].includes(sortBy)
                    ) {
                        listOptions.sortBy = sortBy;
                    }
                }

                await cli.list(listOptions);
                break;

            case 'update':
                if (args.length < 2) {
                    console.log(colorize('❌ Please provide a todo ID', 'red'));
                    return;
                }

                const id = args[1];
                const updates: any = {};

                for (let i = 2; i < args.length; i += 2) {
                    const flag = args[i];
                    const value = args[i + 1];

                    switch (flag) {
                        case '--title':
                            updates.title = value;
                            break;
                        case '--description':
                            updates.description = value;
                            break;
                        case '--completed':
                            updates.completed = value === 'true';
                            break;
                        case '--priority':
                            if (['low', 'medium', 'high'].includes(value)) {
                                updates.priority = value;
                            }
                            break;
                        case '--due':
                            updates.dueDate = value;
                            break;
                    }
                }

                await cli.update(id, updates);
                break;

            case 'toggle':
                if (args.length < 2) {
                    console.log(colorize('❌ Please provide a todo ID', 'red'));
                    return;
                }
                await cli.toggle(args[1]);
                break;

            case 'delete':
                if (args.length < 2) {
                    console.log(colorize('❌ Please provide a todo ID', 'red'));
                    return;
                }
                await cli.delete(args[1]);
                break;

            case 'stats':
                await cli.stats();
                break;

            case 'help':
            case '--help':
            case '-h':
                cli.showHelp();
                break;

            default:
                console.log(colorize(`❌ Unknown command: ${command}`, 'red'));
                cli.showHelp();
        }
    } catch (error) {
        console.log(colorize(`❌ Unexpected error: ${error}`, 'red'));
    } finally {
        // Clean up database connection
        db.close();
    }
}

// Execute main function
if (import.meta.main) {
    main().catch(console.error);
}
