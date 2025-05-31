export function stringifyDoc(doc: any): string {
  const transformDates = (obj: any): any => {
    if (obj instanceof Date) {
      return { __type: 'Date', value: obj.toISOString() };
    }
    if (Array.isArray(obj)) {
      return obj.map(transformDates);
    }
    if (obj !== null && typeof obj === 'object') {
      const transformed: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          transformed[key] = transformDates(obj[key]);
        }
      }
      return transformed;
    }
    return obj;
  };
  
  return JSON.stringify(transformDates(doc));
}

export function parseDoc(json: string): any {
  return JSON.parse(json, (key, value) => {
    if (value && typeof value === 'object' && value.__type === 'Date') {
      return new Date(value.value);
    }
    return value;
  });
}

/**
 * Merge constrained field values with document JSON, giving priority to constrained field values
 */
export function mergeConstrainedFields(
  row: any, 
  constrainedFields?: { [fieldPath: string]: any }
): any {
  if (!constrainedFields || Object.keys(constrainedFields).length === 0) {
    return parseDoc(row.doc);
  }

  const mergedObject = parseDoc(row.doc);
  
  // Override with constrained field values, handling nested paths
  for (const fieldPath of Object.keys(constrainedFields)) {
    const columnName = fieldPath; // For now, assume simple mapping
    if (row[columnName] !== undefined) {
      // Use constrained field value, even if null (for SET NULL cascades)
      mergedObject[fieldPath] = row[columnName];
    }
  }
  
  return mergedObject;
}