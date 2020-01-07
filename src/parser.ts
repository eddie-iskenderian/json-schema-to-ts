import {whiteBright} from 'cli-color'
import {JSONSchema4Type, JSONSchema4TypeName} from 'json-schema'
import {findKey, includes, isPlainObject, map} from 'lodash'
import {format} from 'util'
import {Options} from './'
import {typeOfSchema} from './typeOfSchema'
import {
  AST,
  hasStandaloneName,
  T_ANY,
  TInterface,
  TInterfaceParam,
  TNamedInterface,
  TTuple
} from './types/AST'
import {JSONSchema, JSONSchemaWithDefinitions, SchemaSchema} from './types/JSONSchema'
import {log} from './utils'

export type Processed = Map<JSONSchema | JSONSchema4Type, AST>

export type UsedNames = Set<string>

export function parse(
  schema: JSONSchema | JSONSchema4Type,
  options: Options,
  rootSchema = schema as JSONSchema,
  keyName?: string,
  isSchema = true,
  processed: Processed = new Map<JSONSchema | JSONSchema4Type, AST>()
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
  schema: JSONSchema,
  options: Options,
  rootSchema: JSONSchema,
  keyName: string | undefined,
  keyNameFromDefinition: string | undefined,
  set: (ast: AST) => AST,
  processed: Processed
) {
  log(whiteBright.bgBlue('parser'), schema, '<-' + typeOfSchema(schema), processed.has(schema) ? '(FROM CACHE)' : '')

  switch (typeOfSchema(schema)) {
    case 'ALL_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.allOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed)),
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'INTERSECTION'
      })
    case 'ANY':
      return set({
        comment: schema.description,
        keyName,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'ANY'
      })
    case 'ANY_OF':
      return set({
        comment: schema.description,
        keyName,
        params: schema.anyOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed)),
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
    case 'CUSTOM_TYPE':
      return set({
        comment: schema.description,
        keyName,
        params: schema.tsType!,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'CUSTOM_TYPE'
      })
    case 'NAMED_ENUM':
      return set({
        comment: schema.description,
        keyName,
        params: schema.enum!.map((_, n) => ({
          ast: parse(_, options, rootSchema, undefined, false, processed),
          keyName: schema.tsEnumNames![n]
        })),
        standaloneName: standaloneName(schema, keyName)!,
        type: 'ENUM'
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
        params: schema.oneOf!.map(_ => parse(_, options, rootSchema, undefined, true, processed)),
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
        if (schema.additionalItems === true) {
          arrayType.spreadParam = {
            type: 'ANY'
          }
        } else if (schema.additionalItems) {
          arrayType.spreadParam = parse(
            schema.additionalItems,
            options,
            rootSchema,
            undefined,
            true,
            processed
          )
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
    case 'UNNAMED_ENUM':
      return set({
        comment: schema.description,
        keyName,
        params: schema.enum!.map(_ => parse(_, options, rootSchema, undefined, false, processed)),
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'UNION'
      })
    case 'UNNAMED_SCHEMA':
      return set(
        newInterface(schema as SchemaSchema, options, rootSchema, processed, keyName, keyNameFromDefinition)
      )
    case 'UNTYPED_ARRAY':
      // normalised to not be undefined
      const minItems = schema.minItems!
      const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : -1
      const params = T_ANY
      if (minItems > 0 || maxItems >= 0) {
        return set({
          comment: schema.description,
          keyName,
          maxItems: schema.maxItems,
          minItems,
          // create a tuple of length N
          params: Array(Math.max(maxItems, minItems) || 0).fill(params),
          // if there is no maximum, then add a spread item to collect the rest
          spreadParam: maxItems >= 0 ? undefined : params,
          standaloneName: standaloneName(schema, keyNameFromDefinition),
          type: 'TUPLE'
        })
      }

      return set({
        comment: schema.description,
        keyName,
        params,
        standaloneName: standaloneName(schema, keyNameFromDefinition),
        type: 'ARRAY'
      })
  }
}

/**
 * Compute a schema name using a series of fallbacks
 */
function standaloneName(schema: JSONSchema, keyNameFromDefinition: string | undefined) {
  return schema.title || schema.id || keyNameFromDefinition
}

function newInterface(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema,
  processed: Processed,
  keyName?: string,
  keyNameFromDefinition?: string
): TInterface {
  const name = standaloneName(schema, keyNameFromDefinition)!
  return {
    comment: schema.description,
    keyName,
    params: parseSchema(schema, options, rootSchema, processed, name),
    standaloneName: name,
    superTypes: parseSuperTypes(schema, options, processed),
    type: 'INTERFACE'
  }
}

function parseSuperTypes(
  schema: SchemaSchema,
  options: Options,
  processed: Processed
): TNamedInterface[] {
  // Type assertion needed because of dereferencing step
  // TODO: Type it upstream
  const superTypes = schema.extends as SchemaSchema | SchemaSchema[] | undefined
  if (!superTypes) {
    return []
  }
  if (Array.isArray(superTypes)) {
    return superTypes.map(_ => newNamedInterface(_, options, _, processed))
  }
  return [newNamedInterface(superTypes, options, superTypes, processed)]
}

function newNamedInterface(
  schema: SchemaSchema,
  options: Options,
  rootSchema: JSONSchema,
  processed: Processed
): TNamedInterface {
  const namedInterface = newInterface(schema, options, rootSchema, processed)
  if (hasStandaloneName(namedInterface)) {
    return namedInterface
  }
  // TODO: Generate name if it doesn't have one
  throw Error(format('Supertype must have standalone name!', namedInterface))
}

// Validates the provided response given the type of an AST
function validateDefault(ast: AST, defaultValue: {}|null): boolean {
  switch (ast.type) {
    case 'ANY':
      return true;
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
    case 'CUSTOM_TYPE':
      return defaultValue === null
    case 'LITERAL':
      return typeof defaultValue === 'boolean'
        || typeof defaultValue === 'string'
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
  rootSchema: JSONSchema,
  processed: Processed,
  parentSchemaName: string
): TInterfaceParam[] {
  let asts: TInterfaceParam[] = map(schema.properties, (value, key: string) => {
    const required: boolean = includes(schema.required || [], key);

    if (!required && value.default === undefined) {
      throw `Property ${ key } in schema ${ schema.id } is not required but has no default. Optional fields must have a specified default value.`;
    }

    const ast: AST = parse(value, options, rootSchema, key, true, processed);    
    //const paramDefault: string = '';
    if (value.default !== undefined && !validateDefault(ast, value.default)) {
      throw `The default of ${ value.default } in schema ${ schema.id } is not a valid default for type ${ ast.type }.`
    }

    return {
      ast,
      isPatternProperty: false,
      isRequired: includes(schema.required || [], key),
      isUnreachableDefinition: false,
      keyName: key,
      default: typeof value.default === 'string' ? `'${ value.default }'` : value.default
    }
  });

  let singlePatternProperty = false
  if (schema.patternProperties) {
    // partially support patternProperties. in the case that
    // there is only a single value definition, we can validate
    // against that.
    singlePatternProperty = Object.keys(schema.patternProperties).length === 1

    asts = asts.concat(
      map(schema.patternProperties, (value, key: string) => {
        const ast = parse(value, options, rootSchema, key, true, processed)
        const comment = `This interface was referenced by \`${parentSchemaName}\`'s JSON-Schema definition
via the \`patternProperty\` "${key}".`
        ast.comment = ast.comment ? `${ast.comment}\n\n${comment}` : comment
        return {
          ast,
          isPatternProperty: !singlePatternProperty,
          isRequired: singlePatternProperty || includes(schema.required || [], key),
          isUnreachableDefinition: false,
          keyName: singlePatternProperty ? '[k: string]' : key
        }
      })
    )
  }

  if (options.unreachableDefinitions) {
    asts = asts.concat(
      map(schema.definitions, (value, key: string) => {
        const ast = parse(value, options, rootSchema, key, true, processed)
        const comment = `This interface was referenced by \`${parentSchemaName}\`'s JSON-Schema
via the \`definition\` "${key}".`
        ast.comment = ast.comment ? `${ast.comment}\n\n${comment}` : comment
        return {
          ast,
          isPatternProperty: false,
          isRequired: includes(schema.required || [], key),
          isUnreachableDefinition: true,
          keyName: key
        }
      })
    )
  }
  return asts;
}

type Definitions = {[k: string]: JSONSchema}

/**
 * TODO: Memoize
 */
function getDefinitions(schema: JSONSchema, isSchema = true, processed = new Set<JSONSchema>()): Definitions {
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
function hasDefinitions(schema: JSONSchema): schema is JSONSchemaWithDefinitions {
  return 'definitions' in schema
}
