import $RefParser = require('json-schema-ref-parser');
import { JSONSchema4 } from 'json-schema';

export type FileReader = (file: $RefParser.FileInfo, _callback?: (error: Error | null, data: string | null) => any) => string | Buffer | Promise<string | Buffer>;

export async function dereference(
  schema: JSONSchema4,
  cwd: string,
  fileReader: FileReader
): Promise<JSONSchema4> {
  const parser = new $RefParser();
  const options: $RefParser.Options = {
    parse: {
      json: true, // Enable the JSON parser
    },
    resolve: {
      file: {
        order: 1,
        canRead: /\.json$/i,
        read: fileReader
      },
      http: false,  // Don't resolve remote file references
    },
    dereference: {
      circular: false                 // Don't allow circular $refs
    }
  };
  return parser.dereference(cwd, schema, options) as JSONSchema4;
}
