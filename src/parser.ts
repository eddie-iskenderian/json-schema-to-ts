import {JSONSchema4, JSONSchema4Type, JSONSchema4TypeName} from 'json-schema'
import {findKey, includes, isPlainObject, map} from 'lodash'
import {format} from 'util'
import {Options} from './'
import {isTypeNullable, typeOfSchema} from './typeOfSchema'
import {
  AST,
  TInterface,
  TInterfaceParam,
  TTuple,
  hasStandaloneName
} from './types/AST'
import {JSONSchemaWithDefinitions, SchemaSchema} from './types/JSONSchema'

export type Processed = Map<JSONSchema4 | JSONSchema4Type, AST>

export type UsedNames = Set<string>

export function parse(
  schema: JSONSchema4 | JSONSchema4Type,
  options: Options,
  rootSchema = schema as JSONSchema4,
  keyName?: string,
  isSchema = true,
  processed: Processed = new Map<JSONSchema4 | JSONSchema4Type, AST>()
): AST {
  // If we've seen this node before, return it.
  if (processed.has(schema)) {
    return processed.get(schema)!
  }

  const definitions = getDefinitions(rootSchema)
  const keyNameFromDefinition = findKey(definitions, _ => _ === schema)

  // Cache processed ASTs before they are actually computed, then update
  // them in place using set(). This is to avoid cycles.
  // TODO: Investigate alternative approaches (lazy-computing nodes, etc.)
  const ast = {} as AST
  processed.set(schema, ast)
  const set = (_ast: AST) => Object.assign(ast, _ast)

  return isSchema
    ? parseNonLiteral(
      schema as SchemaSchema,
      options,
      rootSchema,
      keyName,
      keyNameFromDefinition,
      set,
      processed
    )
  : parseLiteral(schema, keyName, keyNameFromDefinition, set)
}

function parseLiteral(
  schema: JSONSchema4Type,
  keyName: string | undefined,
  keyNameFromDefinition: string | undefined,
  set: (ast: AST) => AST
) {
  return set({
    keyName,
    params: schema,
    standaloneName: keyNameFromDefinition,
    type: 'LITERAL'
  })
}

function parseNonLiteral(
  schema: JSONSchema4,
  options: Options,
  rootSchema: JSONSchema4,
  keyName: string | undefined,
  keyNameFromDefinition: string | undefined,
  set: (ast: AST) => AST,
  processed: Processed
) {
  switch (typeOfSchema(schema)) {
    case 'ALL_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.allOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed)),
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'INTERSECTION'
      })
    case 'ANY_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.anyOf!.map(_ => {
          if (_.properties) {
            const keys = Object.keys(_.properties);
            if (keys.length > 0) {
              _.required = [keys[0]];
            }
          }
          return parse(_, options, rootSchema, undefined, true, processed);
        }),
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'UNION'
      })
    case 'BOOLEAN':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'BOOLEAN'
      })
    case 'NAMED_SCHEMA':
      return set(newInterface(schema as SchemaSchema, options, rootSchema, processed, keyName))
    case 'NULL':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'NULL'
      })
    case 'NUMBER':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'NUMBER'
      })
    case 'OBJECT':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'OBJECT'
      })
    case 'ONE_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.oneOf!.map(_ => {
          if (_.properties) {
            const keys = Object.keys(_.properties);
            if (keys.length > 0) {
              _.required = [keys[0]];
            }
          }
          return parse(_, options, rootSchema, undefined, true, processed);
        }),
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'UNION'
      })
    case 'REFERENCE':
      throw Error(format('Refs should have been resolved by the resolver!', schema))
    case 'STRING':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'STRING'
      })
    case 'TYPED_ARRAY':
      if (Array.isArray(schema.items)) {
        // normalised to not be undefined
        const minItems = schema.minItems!
        const maxItems = schema.maxItems!
        const arrayType: TTuple = {
          comment: schema.description,
          keyName,
          maxItems,
          minItems,
          params: schema.items.map(_ => parse(_, options, rootSchema, undefined, true, processed)),
          standaloneName: standaloneName(schema, keyNameFromDefinition),
          type: 'TUPLE'
        }
        return set(arrayType)
      } else {
        const params = parse(schema.items!, options, rootSchema, undefined, true, processed)
        return set({
          comment: schema.description,
          keyName,
          params,
          standaloneName: standaloneName(schema, keyNameFromDefinition),
          type: 'ARRAY'
        })
      }
    case 'UNION':
      return set({
        comment: schema.description,
        keyName,
        params: (schema.type as JSONSchema4TypeName[]).map(_ =>
          parse({...schema, type: _}, options, rootSchema, undefined, true, processed)
        ),
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'UNION'
      })
    case 'ENUM': {
      let name: string = standaloneName(schema, keyNameFromDefinition);
      if (rootSchema.oneOf || rootSchema.anyOf) {
        name = name || `${ standaloneName(rootSchema, '').replace('.json', '') }_internal_${ schema.enum!.join('_') }`;
      }
      return set({
        comment: schema.description,
        keyName,
        params: schema.enum!.map(_ => parse(_, options, rootSchema, undefined, false, processed)),
        standaloneName: name,
        type: 'ENUM'
      })
    }
    case 'UNNAMED_SCHEMA':
      return set(
        newInterface(schema as SchemaSchema, options, rootSchema, processed, keyName, keyNameFromDefinition)
      )
  }
}

/**
 * Compute a schema name using a series of fallbacks
 */
function standaloneName(schema: JSONSchema4, keyNameFromDefinition: string | undefined): string {
  return schema.title || schema.id || keyNameFromDefinition || '';
}

function newInterface(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema4,
  processed: Processed,
  keyName?: string,
  keyNameFromDefinition?: string
): TInterface {
  let name = standaloneName(schema, keyNameFromDefinition);
  if (!name) {
    if (rootSchema.oneOf || rootSchema.anyOf) {
      if (Object.keys(schema.properties).length !== 1) {
        throw `Objects within a oneOf or anyOf definition can only have one property.`
      }
      const key: string = Object.keys(schema.properties)[0];
      schema.required = [key];
      name = name || `${ standaloneName(rootSchema, '').replace('.json', '') }_internal_${ key }`;
    }
  }
  return {
    comment: schema.description,
    keyName,
    params: parseSchema(schema, options, rootSchema, processed),
    standaloneName: name,
    type: 'INTERFACE'
  }
}

// Validates the provided response given the type of an AST
function validateDefault(ast: AST, defaultValue: {}|null): boolean {
  switch (ast.type) {
    case 'ARRAY':
    case 'TUPLE':
      return Array.isArray(defaultValue) && defaultValue.length == 0;
    case 'BOOLEAN':
      return typeof defaultValue === 'boolean';
    case 'INTERFACE':
    case 'INTERSECTION':
    case 'OBJECT':
    case 'REFERENCE':
    case 'UNION':
      return defaultValue === null
    case 'LITERAL':
      return typeof defaultValue === 'string'
        || typeof defaultValue === 'number'
        || typeof defaultValue === 'boolean';
    case 'NUMBER':
      return typeof defaultValue === 'number';
    case 'NULL':
      return defaultValue === null
    case 'STRING':
      return typeof defaultValue === 'string';
  }
  return false;
}

/**
 * Helper to parse schema properties into params on the parent schema's type
 * Note that 'additionalProperties' are not supported
 */
function parseSchema(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema4,
  processed: Processed
): TInterfaceParam[] {
  let asts: TInterfaceParam[] = map(schema.properties, (value, key: string) => {
    const required: boolean = includes(schema.required || [], key);

    console.log(JSON.stringify(schema, null, 2))
    if (!required && value.default === undefined) {
      throw `Property ${ key } in schema ${ schema.id } is not required but has no default. Optional fields must have a specified default value.`;
    }

    const ast: AST = parse(value, options, rootSchema, key, true, processed);
    const nullable: boolean = value.nullable || isTypeNullable(value);
    if (value.default === null && !nullable && !hasStandaloneName(ast)) {
      console.log('By', JSON.stringify(value, null, 2));
      throw `A default of null in schema ${ schema.id } is not a allowed for a property that is not nullable.` 
    } else if (!nullable && value.default !== undefined && !validateDefault(ast, value.default)) {
      throw `The default of ${ value.default } in schema ${ schema.id } is not a valid default for type ${ ast.type }.`
    }
    return {
      ast,
      isPatternProperty: false,
      isRequired: required,
      isNullable: nullable,
      isUnreachableDefinition: false,
      keyName: key,
      default: typeof value.default === 'string' ? `'${ value.default }'` : value.default
    }
  });
  return asts;
}

type Definitions = {[k: string]: JSONSchema4}

/**
 * TODO: Memoize
 */
function getDefinitions(schema: JSONSchema4, isSchema = true, processed = new Set<JSONSchema4>()): Definitions {
  if (processed.has(schema)) {
    return {}
  }
  processed.add(schema)
  if (Array.isArray(schema)) {
    return schema.reduce(
      (prev, cur) => ({
        ...prev,
        ...getDefinitions(cur, false, processed)
      }),
      {}
    )
  }
  if (isPlainObject(schema)) {
    return {
      ...(isSchema && hasDefinitions(schema) ? schema.definitions : {}),
      ...Object.keys(schema).reduce<Definitions>(
        (prev, cur) => ({
          ...prev,
          ...getDefinitions(schema[cur], false, processed)
        }),
        {}
      )
    }
  }
  return {}
}

/**
 * TODO: Reduce rate of false positives
 */
function hasDefinitions(schema: JSONSchema4): schema is JSONSchemaWithDefinitions {
  return 'definitions' in schema
}
