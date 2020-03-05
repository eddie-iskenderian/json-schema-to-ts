import { JSONSchema4, JSONSchema4TypeName } from 'json-schema'

export type SCHEMA_TYPE = 'ALL_OF' | 'UNNAMED_SCHEMA' | 'ANY_OF'
  | 'BOOLEAN' | 'NAMED_SCHEMA' | 'NULL' | 'NUMBER' | 'STRING' | 'ENUM'
  | 'OBJECT' | 'ONE_OF' | 'TYPED_ARRAY' | 'REFERENCE' | 'UNION'

export type JSONSchemaTypeName = JSONSchema4TypeName

export interface NormalizedJSONSchema extends JSONSchema4 {
  items?: NormalizedJSONSchema | NormalizedJSONSchema[]
  definitions?: {
    [k: string]: NormalizedJSONSchema
  }
  properties?: {
    [k: string]: NormalizedJSONSchema
  }
  patternProperties?: {
    [k: string]: NormalizedJSONSchema
  }
  dependencies?: {
    [k: string]: NormalizedJSONSchema | string[]
  }
  allOf?: NormalizedJSONSchema[]
  anyOf?: NormalizedJSONSchema[]
  oneOf?: NormalizedJSONSchema[]
  not?: NormalizedJSONSchema
  required: string[]
}

export interface SchemaSchema extends NormalizedJSONSchema {
  properties: {
    [k: string]: NormalizedJSONSchema
  }
  required: string[]
}

export interface JSONSchemaWithDefinitions extends NormalizedJSONSchema {
  definitions: {
    [k: string]: NormalizedJSONSchema
  }
}
