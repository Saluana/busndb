#!/usr/bin/env tsx

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
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

// Database setup with persistent storage (explicitly use Node driver)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, 'todos.db');
const db = createDB({ path: DB_PATH, driver: 'node' });

// Create collection without complex type inference
interface TodoCollection {
    insert(data: Partial<Todo>): Promise<Todo>;
    orderBy(field: string, direction: string): { toArray(): Promise<Todo[]> };
    where(field: string): { eq(value: any): { count(): Promise<number> } };
    put(id: string, data: Partial<Todo>): Promise<void>;
    delete(id: string): Promise<void>;
    toArray(): Promise<Todo[]>;
    count(): Promise<number>;
}

const todos = db.collection('todos', todoSchema) as TodoCollection;

const PRIORITIES = ['low', 'medium', 'high'] as const;

function formatDate(date?: Date) {
    if (!date) return '';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const MainMenu = ({ onSelect }: { onSelect: (action: string) => void }) => (
    <Box flexDirection="column">
        <Text color="cyanBright">📝 Todo CLI (Interactive)</Text>
        <SelectInput
            items={[
                { label: 'View Todos', value: 'list' },
                { label: 'Add Todo', value: 'add' },
                { label: 'Toggle Complete', value: 'toggle' },
                { label: 'Edit Todo', value: 'edit' },
                { label: 'Delete Todo', value: 'delete' },
                { label: 'Stats', value: 'stats' },
                { label: 'Exit', value: 'exit' },
            ]}
            onSelect={(item) => onSelect(item.value)}
        />
    </Box>
);

const ListTodos = ({ onBack }: { onBack: () => void }) => {
    const [todoList, setTodoList] = useState<Todo[]>([]);
    useEffect(() => {
        (async () => {
            setTodoList(await todos.orderBy('createdAt', 'desc').toArray());
        })();
    }, []);
    return (
        <Box flexDirection="column">
            <Text color="yellowBright">\n📋 Todos:</Text>
            {todoList.length === 0 && <Text color="gray">No todos found.</Text>}
            {todoList.map((todo, i) => (
                <Box key={todo.id || i}>
                    <Text>
                        {todo.completed ? '✅' : '⭕'} {todo.title}{' '}
                        {todo.priority === 'high'
                            ? '🔴'
                            : todo.priority === 'medium'
                            ? '🟡'
                            : '🟢'}
                        {todo.dueDate
                            ? `  (Due: ${formatDate(todo.dueDate)})`
                            : ''}
                    </Text>
                </Box>
            ))}
            <Text> </Text>
            <Text color="cyan">Press [b] to go back</Text>
            <KeyHandler keyCode="b" onKey={onBack} />
        </Box>
    );
};

const AddTodo = ({ onDone }: { onDone: () => void }) => {
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(
        'medium'
    );
    const [due, setDue] = useState('');
    const [step, setStep] = useState(0);
    const [error, setError] = useState('');
    const { exit } = useApp();

    useInput((input, key) => {
        if (key.escape) onDone();
    });

    async function handleSubmit() {
        try {
            await todos.insert({
                title: title.trim(),
                description: desc.trim() || undefined,
                priority,
                dueDate: due ? new Date(due) : undefined,
            });
            onDone();
        } catch (e: any) {
            setError(e.message || String(e));
        }
    }

    if (step === 0) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Enter title:</Text>
                <TextInput
                    value={title}
                    onChange={setTitle}
                    onSubmit={() => setStep(1)}
                />
                <Text color="gray">
                    (Press Enter to continue, Esc to cancel)
                </Text>
                {error && <Text color="red">{error}</Text>}
            </Box>
        );
    }
    if (step === 1) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Enter description (optional):</Text>
                <TextInput
                    value={desc}
                    onChange={setDesc}
                    onSubmit={() => setStep(2)}
                />
                <Text color="gray">
                    (Press Enter to continue, Esc to cancel)
                </Text>
            </Box>
        );
    }
    if (step === 2) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Select priority (low/medium/high):</Text>
                <TextInput
                    value={priority}
                    onChange={(v) => setPriority(v as any)}
                    onSubmit={() => setStep(3)}
                />
                <Text color="gray">
                    (Press Enter to continue, Esc to cancel)
                </Text>
            </Box>
        );
    }
    if (step === 3) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Due date (YYYY-MM-DD, optional):</Text>
                <TextInput
                    value={due}
                    onChange={setDue}
                    onSubmit={handleSubmit}
                />
                <Text color="gray">(Press Enter to save, Esc to cancel)</Text>
            </Box>
        );
    }
    return null;
};

const ToggleTodo = ({ onDone }: { onDone: () => void }) => {
    const [todoList, setTodoList] = useState<Todo[]>([]);
    useEffect(() => {
        (async () => {
            setTodoList(await todos.orderBy('createdAt', 'desc').toArray());
        })();
    }, []);
    const items = todoList
        .filter((todo) => todo.id) // Only include todos with IDs
        .map((todo) => ({
            label: `${todo.completed ? '✅' : '⭕'} ${todo.title}`,
            value: todo.id!,
        }));
    return (
        <Box flexDirection="column">
            <Text color="yellow">Toggle completion status:</Text>
            <SelectInput
                items={items}
                onSelect={async (item) => {
                    const todo = todoList.find((t) => t.id === item.value);
                    if (todo && todo.id) {
                        await todos.put(todo.id, {
                            completed: !todo.completed,
                            updatedAt: new Date(),
                        });
                    }
                    onDone();
                }}
            />
            <Text color="gray">(Esc to cancel)</Text>
        </Box>
    );
};

const EditTodo = ({ onDone }: { onDone: () => void }) => {
    const [todoList, setTodoList] = useState<Todo[]>([]);
    const [selected, setSelected] = useState<Todo | null>(null);
    const [title, setTitle] = useState('');
    const [desc, setDesc] = useState('');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(
        'medium'
    );
    const [due, setDue] = useState('');
    const [step, setStep] = useState(0);
    useEffect(() => {
        (async () => {
            setTodoList(await todos.orderBy('createdAt', 'desc').toArray());
        })();
    }, []);
    if (!selected) {
        const items = todoList
            .filter((todo) => todo.id) // Only include todos with IDs
            .map((todo) => ({
                label: `${todo.title} (${todo.completed ? '✅' : '⭕'})`,
                value: todo.id!,
            }));
        return (
            <Box flexDirection="column">
                <Text color="yellow">Select a todo to edit:</Text>
                <SelectInput
                    items={items}
                    onSelect={(item) => {
                        const todo = todoList.find((t) => t.id === item.value);
                        if (todo) {
                            setSelected(todo);
                            setTitle(todo.title);
                            setDesc(todo.description || '');
                            setPriority(todo.priority);
                            setDue(
                                todo.dueDate
                                    ? todo.dueDate.toISOString().slice(0, 10)
                                    : ''
                            );
                            setStep(1);
                        }
                    }}
                />
                <Text color="gray">(Esc to cancel)</Text>
            </Box>
        );
    }
    async function handleSave() {
        if (!selected || !selected.id) return;
        await todos.put(selected.id, {
            title: title.trim(),
            description: desc.trim() || undefined,
            priority,
            dueDate: due ? new Date(due) : undefined,
            updatedAt: new Date(),
        });
        onDone();
    }
    if (step === 1) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Edit title:</Text>
                <TextInput
                    value={title}
                    onChange={setTitle}
                    onSubmit={() => setStep(2)}
                />
            </Box>
        );
    }
    if (step === 2) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Edit description:</Text>
                <TextInput
                    value={desc}
                    onChange={setDesc}
                    onSubmit={() => setStep(3)}
                />
            </Box>
        );
    }
    if (step === 3) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Edit priority (low/medium/high):</Text>
                <TextInput
                    value={priority}
                    onChange={(v) => setPriority(v as any)}
                    onSubmit={() => setStep(4)}
                />
            </Box>
        );
    }
    if (step === 4) {
        return (
            <Box flexDirection="column">
                <Text color="yellow">Edit due date (YYYY-MM-DD):</Text>
                <TextInput
                    value={due}
                    onChange={setDue}
                    onSubmit={handleSave}
                />
            </Box>
        );
    }
    return null;
};

const DeleteTodo = ({ onDone }: { onDone: () => void }) => {
    const [todoList, setTodoList] = useState<Todo[]>([]);
    useEffect(() => {
        (async () => {
            setTodoList(await todos.orderBy('createdAt', 'desc').toArray());
        })();
    }, []);
    const items = todoList
        .filter((todo) => todo.id) // Only include todos with IDs
        .map((todo) => ({
            label: `${todo.title} (${todo.completed ? '✅' : '⭕'})`,
            value: todo.id!,
        }));
    return (
        <Box flexDirection="column">
            <Text color="yellow">Select a todo to delete:</Text>
            <SelectInput
                items={items}
                onSelect={async (item) => {
                    if (item.value) {
                        await todos.delete(item.value);
                    }
                    onDone();
                }}
            />
            <Text color="gray">(Esc to cancel)</Text>
        </Box>
    );
};

const Stats = ({ onBack }: { onBack: () => void }) => {
    const [stats, setStats] = useState<any>(null);
    useEffect(() => {
        (async () => {
            const all = await todos.toArray();
            const completed = await todos.where('completed').eq(true).count();
            const pending = await todos.where('completed').eq(false).count();
            const highPriority = await todos
                .where('priority')
                .eq('high')
                .count();
            const overdue = all.filter(
                (t) => t.dueDate && t.dueDate < new Date() && !t.completed
            ).length;
            setStats({
                total: all.length,
                completed,
                pending,
                highPriority,
                overdue,
                completionRate:
                    all.length > 0
                        ? ((completed / all.length) * 100).toFixed(1)
                        : '0',
            });
        })();
    }, []);
    if (!stats) return <Text color="gray">Loading...</Text>;
    return (
        <Box flexDirection="column">
            <Text color="magentaBright">\n📊 Todo Statistics:</Text>
            <Text>Total Todos: {stats.total}</Text>
            <Text>✅ Completed: {stats.completed}</Text>
            <Text>⭕ Pending: {stats.pending}</Text>
            <Text>🔴 High Priority: {stats.highPriority}</Text>
            {stats.overdue > 0 && <Text>⚠️ Overdue: {stats.overdue}</Text>}
            <Text>📈 Completion Rate: {stats.completionRate}%</Text>
            <Text> </Text>
            <Text color="cyan">Press [b] to go back</Text>
            <KeyHandler keyCode="b" onKey={onBack} />
        </Box>
    );
};

function KeyHandler({ keyCode, onKey }: { keyCode: string; onKey: () => void }) {
    useInput((input, k) => {
        if (input === keyCode) onKey();
    });
    return null;
}

const App = () => {
    const [screen, setScreen] = useState<
        'menu' | 'list' | 'add' | 'toggle' | 'edit' | 'delete' | 'stats'
    >('menu');
    return (
        <Box flexDirection="column">
            {screen === 'menu' && (
                <MainMenu
                    onSelect={(action) => {
                        if (action === 'exit') process.exit(0);
                        setScreen(action as any);
                    }}
                />
            )}
            {screen === 'list' && (
                <ListTodos onBack={() => setScreen('menu')} />
            )}
            {screen === 'add' && <AddTodo onDone={() => setScreen('menu')} />}
            {screen === 'toggle' && (
                <ToggleTodo onDone={() => setScreen('menu')} />
            )}
            {screen === 'edit' && <EditTodo onDone={() => setScreen('menu')} />}
            {screen === 'delete' && (
                <DeleteTodo onDone={() => setScreen('menu')} />
            )}
            {screen === 'stats' && <Stats onBack={() => setScreen('menu')} />}
        </Box>
    );
};

// Check if this is the main module (Node.js equivalent of import.meta.main)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    render(<App />);
}
