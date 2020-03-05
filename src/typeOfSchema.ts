import {SCHEMA_TYPE} from './types/JSONSchema'
import {JSONSchema4, JSONSchema4TypeName} from 'json-schema';

export function isTypeNullable(schema: JSONSchema4): boolean {
  const rawType: JSONSchema4TypeName | JSONSchema4TypeName[] | string | undefined = schema.type;
  if (rawType) {
    let types: string[];
    if (typeof rawType === 'string') {
      types =  rawType.split(/\s*,\s*/);
    } else if (Array.isArray(rawType)) {
      types = rawType;
    } else {
      throw `Invalid schema type ${ JSON.stringify(rawType) }`;
    }

    if (types.length === 1 || types.filter(t => t !== 'null').length === 0) {
      // Any single type, including null are treated as non-nullable
      return false; 
    } else if (!types.includes('null')) {
      throw `Multiple type specification of '${ rawType }' must include 'null'`;
    } else if (types.length !== 2) {
      throw `Multiple type specification of '${ rawType }' can only include one non-null JSON type`;
    } else 
    return true;
  }
  return false;
}

export function extractType(schemaType: string|undefined) {
  if (schemaType === undefined) {
    return schemaType;
  }
  return schemaType.replace(/(\s|,|null)/g, '');
}

/**
 * Duck types a JSONSchema schema or property to determine which kind of AST node to parse it into.
 */
export function typeOfSchema(schema: JSONSchema4): SCHEMA_TYPE {
  // Extract the type from the schema element.
  if (schema.allOf) return 'ALL_OF'
  if (schema.anyOf) return 'ANY_OF'
  if (schema.oneOf) return 'ONE_OF'
  if (schema.$ref) return 'REFERENCE'
  if (schema.items) return 'TYPED_ARRAY'
  if (schema.enum) return 'ENUM'

  // Extract the type from the explicit JSON schema type.
  let schemaType: string[]|string|undefined = schema.type;
  if (Array.isArray(schemaType)) {
    if (schemaType.length === 0) {
      throw 'Type arrays must have at least one element'
    } else if (schemaType.length > 2) {
      throw 'Array type specifiers cannot contain more than 2 types.'
    } else if (schemaType.length === 2 && !schemaType.includes('null')) {
      throw 'Type arrays with more than one element must have a null item.';
    }
    const typeInArray: string[] = schemaType.filter(t => t !== 'null');
    if (typeInArray.length === 0) {
      return 'NULL'
    }
    // Process the schema type as a string
    schemaType = typeInArray[0];
  }
  if (schemaType === 'null') return 'NULL'

  switch (extractType(schemaType)) {
    case 'string':
      return 'STRING'
    case 'number':
      return 'NUMBER'
    case 'integer':
      return 'NUMBER'
    case 'boolean':
      return 'BOOLEAN'
    case 'object':
    case undefined:
      break;
    default:
      throw `'${ schemaType }' is an unsupported type.`;
  }
  return 'NAMED_SCHEMA'
}
