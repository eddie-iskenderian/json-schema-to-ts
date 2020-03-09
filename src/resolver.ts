import $RefParser = require('json-schema-ref-parser');
import { JSONSchema4 } from 'json-schema';

export async function dereference(
  schema: JSONSchema4,
  cwd: string
): Promise<JSONSchema4> {
  const parser = new $RefParser();
  return parser.dereference(cwd, schema, {}) as JSONSchema4;
}
