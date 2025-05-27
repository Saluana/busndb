import { z } from 'zod';
import { createDB } from './src/index.js';

// Define comprehensive schemas
const userSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int(),
  salary: z.number(),
  isActive: z.boolean(),
  department: z.string(),
  skills: z.array(z.string()),
  metadata: z.object({
    joinDate: z.date(),
    level: z.enum(['junior', 'mid', 'senior', 'lead']),
    remote: z.boolean()
  }).optional(),
  createdAt: z.date().default(() => new Date())
});

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['planning', 'active', 'completed', 'cancelled']),
  budget: z.number(),
  leadId: z.string().uuid(),
  priority: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  startDate: z.date(),
  endDate: z.date().optional(),
  createdAt: z.date().default(() => new Date())
});

async function demonstrateQueryBuilder() {
  console.log('=== BusNDB Query Builder - Feature Complete Demo ===\n');
  
  const db = createDB({ memory: true });
  const users = db.collection('users', userSchema);
  const projects = db.collection('projects', projectSchema);
  
  // Insert comprehensive test data
  console.log('1. Inserting test data...');
  
  const userData = [
    {
      name: 'Alice Johnson',
      email: 'alice@company.com',
      age: 28,
      salary: 85000,
      isActive: true,
      department: 'Engineering',
      skills: ['JavaScript', 'TypeScript', 'React', 'Node.js'],
      metadata: {
        joinDate: new Date('2022-01-15'),
        level: 'senior' as const,
        remote: true
      }
    },
    {
      name: 'Bob Smith',
      email: 'bob@company.com',
      age: 32,
      salary: 75000,
      isActive: true,
      department: 'Engineering',
      skills: ['Python', 'Django', 'PostgreSQL'],
      metadata: {
        joinDate: new Date('2021-06-10'),
        level: 'mid' as const,
        remote: false
      }
    },
    {
      name: 'Carol Davis',
      email: 'carol@company.com',
      age: 35,
      salary: 95000,
      isActive: true,
      department: 'Product',
      skills: ['Product Management', 'Analytics', 'User Research'],
      metadata: {
        joinDate: new Date('2020-03-20'),
        level: 'lead' as const,
        remote: true
      }
    },
    {
      name: 'David Wilson',
      email: 'david@company.com',
      age: 26,
      salary: 65000,
      isActive: false,
      department: 'Marketing',
      skills: ['Content Marketing', 'SEO', 'Social Media'],
      metadata: {
        joinDate: new Date('2023-02-01'),
        level: 'junior' as const,
        remote: false
      }
    },
    {
      name: 'Eve Brown',
      email: 'eve@company.com',
      age: 30,
      salary: 80000,
      isActive: true,
      department: 'Design',
      skills: ['UI/UX', 'Figma', 'Prototyping']
      // No metadata
    }
  ];
  
  const insertedUsers = users.insertBulk(userData);
  console.log(`Inserted ${insertedUsers.length} users`);
  
  const projectData = [
    {
      name: 'Mobile App Redesign',
      description: 'Complete redesign of the mobile application',
      status: 'active' as const,
      budget: 150000,
      leadId: insertedUsers[0].id, // Alice
      priority: 1,
      tags: ['mobile', 'ui', 'redesign'],
      startDate: new Date('2024-01-01')
    },
    {
      name: 'API Optimization',
      description: 'Optimize backend API performance',
      status: 'planning' as const,
      budget: 75000,
      leadId: insertedUsers[1].id, // Bob
      priority: 2,
      tags: ['backend', 'performance', 'api'],
      startDate: new Date('2024-02-15')
    },
    {
      name: 'Marketing Campaign',
      description: 'Q1 marketing campaign launch',
      status: 'completed' as const,
      budget: 50000,
      leadId: insertedUsers[3].id, // David
      priority: 3,
      tags: ['marketing', 'campaign'],
      startDate: new Date('2023-10-01'),
      endDate: new Date('2023-12-31')
    }
  ];
  
  const insertedProjects = projects.insertBulk(projectData);
  console.log(`Inserted ${insertedProjects.length} projects\n`);
  
  // Demonstrate all query builder features
  console.log('2. Basic Comparison Operators:');
  
  console.log('\n- Equality (eq):');
  const engineeringUsers = users.where('department').eq('Engineering').toArray();
  console.log(`Engineering users: ${engineeringUsers.map(u => u.name).join(', ')}`);
  
  console.log('\n- Not Equal (neq):');
  const nonEngineering = users.where('department').neq('Engineering').toArray();
  console.log(`Non-engineering users: ${nonEngineering.map(u => u.name).join(', ')}`);
  
  console.log('\n- Greater Than (gt):');
  const highEarners = users.where('salary').gt(80000).toArray();
  console.log(`High earners (>80k): ${highEarners.map(u => `${u.name} ($${u.salary})`).join(', ')}`);
  
  console.log('\n- Between range:');
  const midCareer = users.where('age').between(28, 32).toArray();
  console.log(`Mid-career (28-32): ${midCareer.map(u => `${u.name} (${u.age})`).join(', ')}`);
  
  console.log('\n3. Array Operations:');
  
  console.log('\n- In array:');
  const seniorOrLead = users.where('age').in([28, 35]).toArray();
  console.log(`Ages 28 or 35: ${seniorOrLead.map(u => `${u.name} (${u.age})`).join(', ')}`);
  
  console.log('\n- Not in array:');
  const excludeAges = users.where('age').nin([26, 35]).toArray();
  console.log(`Not 26 or 35: ${excludeAges.map(u => `${u.name} (${u.age})`).join(', ')}`);
  
  console.log('\n4. String Operations:');
  
  console.log('\n- Starts with:');
  const aNames = users.where('name').startsWith('A').toArray();
  console.log(`Names starting with 'A': ${aNames.map(u => u.name).join(', ')}`);
  
  console.log('\n- Contains:');
  const companyEmails = users.where('email').contains('company.com').toArray();
  console.log(`Company emails: ${companyEmails.length} users`);
  
  console.log('\n- Case insensitive like:');
  const smithUsers = users.where('name').ilike('%smith%').toArray();
  console.log(`Names containing 'smith' (case insensitive): ${smithUsers.map(u => u.name).join(', ')}`);
  
  console.log('\n5. Existence Checks:');
  
  console.log('\n- Has metadata:');
  const withMetadata = users.where('metadata').exists().toArray();
  console.log(`Users with metadata: ${withMetadata.map(u => u.name).join(', ')}`);
  
  console.log('\n- No metadata:');
  const withoutMetadata = users.where('metadata').notExists().toArray();
  console.log(`Users without metadata: ${withoutMetadata.map(u => u.name).join(', ')}`);
  
  console.log('\n6. Complex Queries:');
  
  console.log('\n- Multiple conditions:');
  const activeHighEarners = users
    .where('isActive').eq(true)
    .where('salary').gte(80000)
    .where('age').lt(35)
    .toArray();
  console.log(`Active high earners under 35: ${activeHighEarners.map(u => `${u.name} (${u.age}, $${u.salary})`).join(', ')}`);
  
  console.log('\n- Complex project query:');
  const priorityProjects = projects
    .where('priority').lte(2)
    .where('budget').gt(70000)
    .where('status').in(['active', 'planning'])
    .toArray();
  console.log(`High priority, high budget projects: ${priorityProjects.map(p => `${p.name} (Priority ${p.priority}, $${p.budget})`).join(', ')}`);
  
  console.log('\n7. Sorting:');
  
  console.log('\n- Single field sort:');
  const usersByAge = users.orderBy('age', 'asc').toArray();
  console.log(`Users by age: ${usersByAge.map(u => `${u.name} (${u.age})`).join(', ')}`);
  
  console.log('\n- Multiple field sort:');
  const usersByDeptAndSalary = users
    .orderBy('department', 'asc')
    .orderBy('salary', 'desc')
    .toArray();
  console.log('Users by department, then salary (desc):');
  usersByDeptAndSalary.forEach(u => {
    console.log(`  ${u.department}: ${u.name} ($${u.salary})`);
  });
  
  console.log('\n- Multi-field sort (bulk):');
  const sortedUsers = users.orderByMultiple([
    { field: 'isActive', direction: 'desc' },
    { field: 'salary', direction: 'desc' }
  ]).toArray();
  console.log('Users by active status, then salary:');
  sortedUsers.forEach(u => {
    console.log(`  ${u.isActive ? 'Active' : 'Inactive'}: ${u.name} ($${u.salary})`);
  });
  
  console.log('\n8. Pagination:');
  
  console.log('\n- Page-based pagination:');
  const page1 = users.orderBy('name').page(1, 2).toArray();
  const page2 = users.orderBy('name').page(2, 2).toArray();
  const page3 = users.orderBy('name').page(3, 2).toArray();
  console.log(`Page 1: ${page1.map(u => u.name).join(', ')}`);
  console.log(`Page 2: ${page2.map(u => u.name).join(', ')}`);
  console.log(`Page 3: ${page3.map(u => u.name).join(', ')}`);
  
  console.log('\n- Limit and offset:');
  const topEarners = users.orderBy('salary', 'desc').limit(3).toArray();
  console.log(`Top 3 earners: ${topEarners.map(u => `${u.name} ($${u.salary})`).join(', ')}`);
  
  const nextEarners = users.orderBy('salary', 'desc').limit(2).offset(3).toArray();
  console.log(`Next 2 earners: ${nextEarners.map(u => `${u.name} ($${u.salary})`).join(', ')}`);
  
  console.log('\n9. Aggregation:');
  
  console.log('\n- Count with filters:');
  const activeCount = users.where('isActive').eq(true).count();
  console.log(`Active users: ${activeCount}`);
  
  const engineeringCount = users.where('department').eq('Engineering').count();
  console.log(`Engineering users: ${engineeringCount}`);
  
  console.log('\n- First result:');
  const highestPaid = users.orderBy('salary', 'desc').first();
  console.log(`Highest paid: ${highestPaid?.name} ($${highestPaid?.salary})`);
  
  const youngestActive = users
    .where('isActive').eq(true)
    .orderBy('age', 'asc')
    .first();
  console.log(`Youngest active user: ${youngestActive?.name} (${youngestActive?.age})`);
  
  console.log('\n10. Query Builder State Management:');
  
  const builder = users.where('isActive').eq(true);
  console.log(`\n- Initial query has ${builder.getFilterCount()} filters`);
  console.log(`- Has filters: ${builder.hasFilters()}`);
  console.log(`- Has ordering: ${builder.hasOrdering()}`);
  console.log(`- Has pagination: ${builder.hasPagination()}`);
  
  builder.orderBy('salary', 'desc').limit(10);
  console.log(`\n- After adding sort and limit:`);
  console.log(`- Has ordering: ${builder.hasOrdering()}`);
  console.log(`- Has pagination: ${builder.hasPagination()}`);
  
  const cloned = builder.clone();
  cloned.where('age').gt(30);
  console.log(`\n- Original filters: ${builder.getFilterCount()}`);
  console.log(`- Cloned filters: ${cloned.getFilterCount()}`);
  
  console.log('\n11. Advanced Features:');
  
  console.log('\n- Distinct results:');
  const departments = users.distinct().toArray().map(u => u.department);
  const uniqueDepartments = [...new Set(departments)];
  console.log(`Unique departments: ${uniqueDepartments.join(', ')}`);
  
  console.log('\n- Clear operations:');
  const resetBuilder = users.where('age').gt(25).orderBy('name').limit(5);
  console.log(`Before reset - Filters: ${resetBuilder.getFilterCount()}, Has order: ${resetBuilder.hasOrdering()}, Has pagination: ${resetBuilder.hasPagination()}`);
  
  resetBuilder.clearFilters().clearOrder().clearLimit();
  console.log(`After clear - Filters: ${resetBuilder.getFilterCount()}, Has order: ${resetBuilder.hasOrdering()}, Has pagination: ${resetBuilder.hasPagination()}`);
  
  console.log('\n12. Real-world Query Examples:');
  
  console.log('\n- Employee directory search:');
  const searchResults = users
    .where('isActive').eq(true)
    .where('name').contains('o')
    .orderBy('department')
    .orderBy('name')
    .toArray();
  console.log('Active employees with "o" in name:');
  searchResults.forEach(u => {
    console.log(`  ${u.department}: ${u.name} <${u.email}>`);
  });
  
  console.log('\n- Project dashboard query:');
  const activeProjects = projects
    .where('status').in(['active', 'planning'])
    .orderBy('priority', 'asc')
    .orderBy('budget', 'desc')
    .toArray();
  console.log('Active/Planning projects by priority and budget:');
  activeProjects.forEach(p => {
    console.log(`  Priority ${p.priority}: ${p.name} ($${p.budget.toLocaleString()}) - ${p.status}`);
  });
  
  console.log('\n- Senior team members:');
  const seniorTeam = users
    .where('isActive').eq(true)
    .where('salary').gte(80000)
    .where('age').gte(30)
    .orderBy('salary', 'desc')
    .toArray();
  console.log('Senior team members (active, 30+, 80k+):');
  seniorTeam.forEach(u => {
    console.log(`  ${u.name}: ${u.department}, Age ${u.age}, $${u.salary.toLocaleString()}`);
  });
  
  db.close();
  console.log('\n✅ Query Builder demonstration complete!');
}

demonstrateQueryBuilder().catch(console.error);