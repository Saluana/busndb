/**
 * @deprecated This constraint system is deprecated in favor of constrainedFields.
 * Use ConstrainedFieldDefinition in types.ts instead.
 * Only indexes are still supported - constraints are ignored.
 * Will be removed in v2.0.0
 */
export interface UniqueConstraint {
  type: 'unique';
  name?: string;
  fields: string[];
}

/**
 * @deprecated This constraint system is deprecated in favor of constrainedFields.
 * Use ConstrainedFieldDefinition in types.ts instead.
 * Will be removed in v2.0.0
 */
export interface ForeignKeyConstraint {
  type: 'foreign_key';
  name?: string;
  fields: string[];
  referencedTable: string;
  referencedFields: string[];
  onDelete?: 'cascade' | 'set_null' | 'restrict' | 'no_action';
  onUpdate?: 'cascade' | 'set_null' | 'restrict' | 'no_action';
}

/**
 * @deprecated This constraint system is deprecated in favor of constrainedFields.
 * Use ConstrainedFieldDefinition in types.ts instead.
 * Will be removed in v2.0.0
 */
export interface CheckConstraint {
  type: 'check';
  name?: string;
  expression: string;
}

export interface IndexDefinition {
  type: 'index';
  name?: string;
  fields: string[];
  unique?: boolean;
  partial?: string; // WHERE clause for partial index
}

/**
 * @deprecated This constraint system is deprecated in favor of constrainedFields.
 * Use ConstrainedFieldDefinition in types.ts instead.
 * Will be removed in v2.0.0
 */
export type Constraint = UniqueConstraint | ForeignKeyConstraint | CheckConstraint;

/**
 * @deprecated This constraint system is deprecated in favor of constrainedFields.
 * Only indexes are still supported from this interface - constraints are ignored.
 * Use ConstrainedFieldDefinition in types.ts for constraints.
 * Will be removed in v2.0.0
 */
export interface SchemaConstraints {
  constraints?: { [field: string]: Constraint | Constraint[] };
  indexes?: { [name: string]: IndexDefinition };
  tableLevelConstraints?: Constraint[];
}

// Helper functions for defining constraints
/**
 * @deprecated Use constrainedFields with ConstrainedFieldDefinition instead.
 * Will be removed in v2.0.0
 */
export function unique(name?: string): UniqueConstraint {
  return {
    type: 'unique',
    name,
    fields: [] // Will be filled by the field name
  };
}

/**
 * @deprecated Use constrainedFields with ConstrainedFieldDefinition instead.
 * Will be removed in v2.0.0
 */
export function foreignKey(
  referencedTable: string,
  referencedField: string = 'id',
  options: {
    name?: string;
    onDelete?: ForeignKeyConstraint['onDelete'];
    onUpdate?: ForeignKeyConstraint['onUpdate'];
  } = {}
): ForeignKeyConstraint {
  return {
    type: 'foreign_key',
    name: options.name,
    fields: [], // Will be filled by the field name
    referencedTable,
    referencedFields: [referencedField],
    onDelete: options.onDelete || 'restrict',
    onUpdate: options.onUpdate || 'restrict'
  };
}

/**
 * @deprecated Use constrainedFields with ConstrainedFieldDefinition instead.
 * Will be removed in v2.0.0
 */
export function check(expression: string, name?: string): CheckConstraint {
  return {
    type: 'check',
    name,
    expression
  };
}

export function index(
  fields?: string | string[],
  options: {
    name?: string;
    unique?: boolean;
    partial?: string;
  } = {}
): IndexDefinition {
  const fieldArray = fields ? (Array.isArray(fields) ? fields : [fields]) : [];
  
  return {
    type: 'index',
    name: options.name,
    fields: fieldArray,
    unique: options.unique || false,
    partial: options.partial
  };
}

// Composite constraint helpers
/**
 * @deprecated Use constrainedFields with ConstrainedFieldDefinition instead.
 * Will be removed in v2.0.0
 */
export function compositeUnique(fields: string[], name?: string): UniqueConstraint {
  return {
    type: 'unique',
    name,
    fields
  };
}

/**
 * @deprecated Use constrainedFields with ConstrainedFieldDefinition instead.
 * Will be removed in v2.0.0
 */
export function compositeForeignKey(
  fields: string[],
  referencedTable: string,
  referencedFields: string[],
  options: {
    name?: string;
    onDelete?: ForeignKeyConstraint['onDelete'];
    onUpdate?: ForeignKeyConstraint['onUpdate'];
  } = {}
): ForeignKeyConstraint {
  return {
    type: 'foreign_key',
    name: options.name,
    fields,
    referencedTable,
    referencedFields,
    onDelete: options.onDelete || 'restrict',
    onUpdate: options.onUpdate || 'restrict'
  };
}