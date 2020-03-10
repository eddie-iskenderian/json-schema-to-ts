import { JSONSchema4 } from 'json-schema';
import { endsWith } from 'lodash';
import { format, Options as PrettierOptions } from 'prettier';
import { generate } from './generator';
import { normalize } from './normalizer';
import { parse } from './parser';
import { dereference, FileReader } from './resolver';
import { validate } from './validator';

export async function compile(schema: JSONSchema4, name: string, cwd: string, reader: FileReader): Promise<string> {
  const errors = validate(schema, name);
  if (errors.length) {
    errors.forEach(console.error);
    throw new Error();
  }
  if (!endsWith(cwd, '/')) {
    cwd += '/';
  }
  const code: string = generate(parse(await dereference(normalize(schema, name), cwd, reader)));
  const stypeOptions: PrettierOptions = {
    bracketSpacing: false,
    printWidth: 80,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: 'none',
    useTabs: false
  };
  console.log(code);
  return format(code, { parser: 'typescript', ...stypeOptions });
}

export class ValidationError extends Error {}
