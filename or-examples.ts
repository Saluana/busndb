import { z } from 'zod';
import { createDB } from './src/index.js';

const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int(),
  department: z.string(),
  salary: z.number(),
  isActive: z.boolean(),
  level: z.enum(['junior', 'mid', 'senior', 'lead']),
  skills: z.array(z.string()),
  location: z.string(),
  createdAt: z.date().default(() => new Date())
});

async function demonstrateOrQueries() {
  console.log('=== BusNDB OR Query Operations Demo ===\n');
  
  const db = createDB({ memory: true });
  const users = db.collection('users', userSchema);
  
  // Insert test data
  const userData = [
    {
      name: 'Alice Johnson',
      email: 'alice@company.com',
      age: 28,
      department: 'Engineering',
      salary: 95000,
      isActive: true,
      level: 'senior' as const,
      skills: ['JavaScript', 'React', 'TypeScript'],
      location: 'New York'
    },
    {
      name: 'Bob Smith',
      email: 'bob@company.com',
      age: 35,
      department: 'Marketing',
      salary: 75000,
      isActive: true,
      level: 'mid' as const,
      skills: ['SEO', 'Content Marketing'],
      location: 'Remote'
    },
    {
      name: 'Carol Davis',
      email: 'carol@company.com',
      age: 42,
      department: 'Engineering',
      salary: 120000,
      isActive: false,
      level: 'lead' as const,
      skills: ['Python', 'Architecture', 'Leadership'],
      location: 'San Francisco'
    },
    {
      name: 'David Wilson',
      email: 'david@company.com',
      age: 26,
      department: 'Sales',
      salary: 65000,
      isActive: true,
      level: 'junior' as const,
      skills: ['CRM', 'Cold Calling'],
      location: 'Chicago'
    },
    {
      name: 'Eve Brown',
      email: 'eve@company.com',
      age: 31,
      department: 'Product',
      salary: 110000,
      isActive: true,
      level: 'senior' as const,
      skills: ['Product Management', 'Analytics'],
      location: 'Austin'
    }
  ];
  
  users.insertBulk(userData);
  console.log(`Inserted ${userData.length} users\n`);
  
  console.log('=== Basic OR Operations ===\n');
  
  // Simple OR condition
  console.log('1. Simple OR: Engineering OR Marketing departments');
  const deptSearch = users
    .where('department').eq('Engineering')
    .or(builder => builder.where('department').eq('Marketing'))
    .toArray();
  
  deptSearch.forEach(user => {
    console.log(`  ${user.name}: ${user.department}`);
  });
  
  // OR with multiple conditions in each branch
  console.log('\n2. Complex OR: (Young Engineers) OR (High Salary + Active)');
  const complexOr = users
    .where('department').eq('Engineering')
    .where('age').lt(30)
    .or(builder => 
      builder.where('salary').gt(100000)
        .where('isActive').eq(true)
    )
    .toArray();
  
  complexOr.forEach(user => {
    console.log(`  ${user.name}: ${user.department}, Age ${user.age}, $${user.salary}, Active: ${user.isActive}`);
  });
  
  console.log('\n=== Advanced OR Patterns ===\n');
  
  // Multiple OR conditions using orWhere
  console.log('3. Multiple OR conditions: Senior level OR Remote location OR High salary');
  const multiOr = users
    .where('level').eq('senior')
    .orWhere([
      builder => builder.where('location').eq('Remote'),
      builder => builder.where('salary').gt(100000)
    ])
    .toArray();
  
  multiOr.forEach(user => {
    console.log(`  ${user.name}: ${user.level}, ${user.location}, $${user.salary}`);
  });
  
  // Chained OR operations
  console.log('\n4. Chained OR: Young OR Marketing OR High earners');
  const chainedOr = users
    .where('age').lt(30)
    .or(builder => builder.where('department').eq('Marketing'))
    .or(builder => builder.where('salary').gt(110000))
    .toArray();
  
  chainedOr.forEach(user => {
    console.log(`  ${user.name}: Age ${user.age}, ${user.department}, $${user.salary}`);
  });
  
  console.log('\n=== Real-world OR Examples ===\n');
  
  // Employee search - flexible criteria
  console.log('5. Employee Search: Name contains "a" OR Email contains "bob" OR Department is Sales');
  const employeeSearch = users
    .where('name').ilike('%a%')
    .or(builder => builder.where('email').contains('bob'))
    .or(builder => builder.where('department').eq('Sales'))
    .orderBy('name')
    .toArray();
  
  employeeSearch.forEach(user => {
    console.log(`  ${user.name} <${user.email}> - ${user.department}`);
  });
  
  // Emergency contact list
  console.log('\n6. Emergency Contacts: (Active + Key Departments) OR (Leadership Levels)');
  const emergencyContacts = users
    .where('isActive').eq(true)
    .where('department').in(['Engineering', 'Product'])
    .or(builder => 
      builder.where('level').in(['senior', 'lead'])
    )
    .orderBy('level', 'desc')
    .orderBy('department')
    .toArray();
  
  emergencyContacts.forEach(user => {
    console.log(`  ${user.name}: ${user.level} ${user.department} (Active: ${user.isActive})`);
  });
  
  // Promotion candidates
  console.log('\n7. Promotion Candidates: (Mid-level + High Performance) OR (Long tenure) OR (Critical skills)');
  const promotionCandidates = users
    .where('level').eq('mid')
    .where('salary').gte(70000)
    .or(builder => 
      builder.where('age').gt(35)
    )
    .or(builder => 
      builder.where('skills').contains('Leadership')
        .or(subBuilder => subBuilder.where('skills').contains('Architecture'))
    )
    .toArray();
  
  promotionCandidates.forEach(user => {
    console.log(`  ${user.name}: ${user.level}, Age ${user.age}, Skills: ${user.skills.join(', ')}`);
  });
  
  console.log('\n=== OR with Aggregations ===\n');
  
  // Count with OR conditions
  const activeOrSenior = users
    .where('isActive').eq(true)
    .or(builder => builder.where('level').eq('senior'))
    .count();
  
  console.log(`8. Count - Active OR Senior employees: ${activeOrSenior}`);
  
  // Get first result with OR
  const topCandidate = users
    .where('salary').gt(90000)
    .or(builder => 
      builder.where('level').eq('lead')
    )
    .orderBy('salary', 'desc')
    .first();
  
  console.log(`\n9. Top Candidate (High salary OR Lead level): ${topCandidate?.name} - $${topCandidate?.salary}`);
  
  console.log('\n=== OR with Pagination ===\n');
  
  // Paginated OR results
  const page1 = users
    .where('department').in(['Engineering', 'Product'])
    .or(builder => builder.where('salary').gt(80000))
    .orderBy('name')
    .page(1, 2)
    .toArray();
  
  const page2 = users
    .where('department').in(['Engineering', 'Product'])
    .or(builder => builder.where('salary').gt(80000))
    .orderBy('name')
    .page(2, 2)
    .toArray();
  
  console.log('10. Paginated Results - (Engineering/Product) OR (Salary > 80k):');
  console.log('Page 1:');
  page1.forEach(user => {
    console.log(`  ${user.name}: ${user.department}, $${user.salary}`);
  });
  
  console.log('Page 2:');
  page2.forEach(user => {
    console.log(`  ${user.name}: ${user.department}, $${user.salary}`);
  });
  
  console.log('\n=== Performance & Optimization ===\n');
  
  // Measure OR query performance
  const start = performance.now();
  
  for (let i = 0; i < 1000; i++) {
    users
      .where('isActive').eq(true)
      .or(builder => 
        builder.where('salary').gt(90000)
          .where('department').eq('Engineering')
      )
      .count();
  }
  
  const end = performance.now();
  
  console.log(`11. Performance Test: 1000 OR queries executed in ${(end - start).toFixed(2)}ms`);
  console.log(`    Average: ${((end - start) / 1000).toFixed(3)}ms per query`);
  
  db.close();
  console.log('\n✅ OR Query demonstration complete!');
}

demonstrateOrQueries().catch(console.error);