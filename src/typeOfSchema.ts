import {isPlainObject} from 'lodash'
import {SCHEMA_TYPE} from './types/JSONSchema'
import {JSONSchema4, JSONSchema4TypeName} from 'json-schema';

export function isTypeNullable(schema: JSONSchema4): boolean {
  const rawType: JSONSchema4TypeName | JSONSchema4TypeName[] | string | undefined = schema.type;
  if (rawType && typeof rawType === 'string') {
    const types =  rawType.split(/\s*,\s*/);
    if (types.length === 1) {
      return false; 
    }
    if (!types.includes('null')) {
      throw `Multiple type specification of '${ rawType }' must include 'null'`;
    } else if (types.length !== 2) {
      throw `Multiple type specification of '${ rawType }' can only include one non-null JSON type`;
    }
    return true;
  }
  return false;
}

/**
 * Duck types a JSONSchema schema or property to determine which kind of AST node to parse it into.
 */
export function typeOfSchema(schema: JSONSchema4): SCHEMA_TYPE {
  if (schema.allOf) return 'ALL_OF'
  if (schema.anyOf) return 'ANY_OF'
  if (schema.oneOf) return 'ONE_OF'
  if (Array.isArray(schema.type)) return 'UNION'
  if (schema.type === 'null') return 'NULL'
  if (schema.items) return 'TYPED_ARRAY'
  if (schema.enum) return 'ENUM'
  if (schema.$ref) return 'REFERENCE'
  switch (schema.type) {
    case 'string':
      return 'STRING'
    case 'number':
      return 'NUMBER'
    case 'integer':
      return 'NUMBER'
    case 'boolean':
      return 'BOOLEAN'
    case 'object':
      if (!schema.properties && !isPlainObject(schema)) {
        return 'OBJECT'
      }
      break
    case 'array':
      return 'UNTYPED_ARRAY'
    case 'any':
      return 'ANY'
  }

  switch (typeof schema.default) {
    case 'boolean':
      return 'BOOLEAN'
    case 'number':
      return 'NUMBER'
    case 'string':
      return 'STRING'
  }
  if (schema.id) return 'NAMED_SCHEMA'
  if (isPlainObject(schema) && Object.keys(schema).length) return 'UNNAMED_SCHEMA'
  return 'ANY'
}
