#!/bin/bash

# Todo CLI Demo Script
# This script demonstrates the Todo CLI application features

echo "🚀 Todo CLI Demo - BusNDB Example"
echo "=================================="
echo ""

echo "📝 Adding some demo todos..."
bun run todo.ts add "Learn TypeScript" --priority high --description "Master advanced TS concepts"
bun run todo.ts add "Build a web app" --priority medium --due 2024-12-31 --description "Full-stack application with React"
bun run todo.ts add "Read documentation" --priority low --description "Study BusNDB docs thoroughly"
bun run todo.ts add "Write tests" --priority high --description "Add comprehensive test coverage"

echo ""
echo "📋 Listing all todos:"
bun run todo.ts list

echo ""
echo "🔥 High priority todos only:"
bun run todo.ts list --priority high

echo ""
echo "✅ Completing a todo:"
# Get the first todo ID and complete it
TODO_ID=$(bun run todo.ts list --priority high 2>/dev/null | grep "ID:" | head -1 | awk '{print $2}' | sed 's/\x1b\[[0-9;]*m//g')
if [ ! -z "$TODO_ID" ]; then
    bun run todo.ts toggle "$TODO_ID"
    echo "   Completed todo: $TODO_ID"
fi

echo ""
echo "📊 Current statistics:"
bun run todo.ts stats

echo ""
echo "✏️ Updating a todo:"
# Get a pending todo ID and update it
PENDING_ID=$(bun run todo.ts list --pending 2>/dev/null | grep "ID:" | head -1 | awk '{print $2}' | sed 's/\x1b\[[0-9;]*m//g')
if [ ! -z "$PENDING_ID" ]; then
    bun run todo.ts update "$PENDING_ID" --priority medium --title "Updated: Learn advanced patterns"
    echo "   Updated todo: $PENDING_ID"
fi

echo ""
echo "📋 Final todo list:"
bun run todo.ts list

echo ""
echo "🎉 Demo completed! Your todos are saved in todos.db"
echo "💾 Database location: $(pwd)/todos.db"
echo ""
echo "Try these commands yourself:"
echo "  bun run todo.ts help              # Show all commands"
echo "  bun run todo.ts add \"New task\"    # Add a new todo"
echo "  bun run todo.ts list --pending     # Show pending todos"
echo "  bun run todo.ts stats              # Show statistics"