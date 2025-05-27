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