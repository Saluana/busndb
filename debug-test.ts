import { z } from 'zod/v4';

const oldField = z.string();
const newField = z.number();

console.log('Old field def:', oldField.def);
console.log('New field def:', newField.def);

function zodTypeToSQL(zodDef) {
    if (!zodDef) {
        return 'TEXT';
    }

    // In Zod v4, _def moved to _zod.def  
    const def = zodDef._zod?.def || zodDef._def || zodDef.def;
    if (!def) {
        return 'TEXT';
    }

    const typeName = def.typeName || def.type;
    
    switch (typeName) {
        case 'ZodString':
        case 'string':
            return 'TEXT';
        case 'ZodNumber':
        case 'number':
            return 'REAL';
        default:
            return 'TEXT';
    }
}

console.log('Old field SQL type:', zodTypeToSQL(oldField));
console.log('New field SQL type:', zodTypeToSQL(newField));
