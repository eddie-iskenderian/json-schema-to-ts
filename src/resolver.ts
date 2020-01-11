import {whiteBright} from 'cli-color'
import $RefParser = require('json-schema-ref-parser')
import {JSONSchema4} from 'json-schema'
import {log} from './utils'

export async function dereference(
  schema: JSONSchema4,
  {cwd, $refOptions}: {cwd: string; $refOptions: $RefParser.Options}
): Promise<JSONSchema4> {
  log(whiteBright.bgGreen('resolver'), schema, cwd)
  const parser = new $RefParser()
  return parser.dereference(cwd, schema, $refOptions)
}
