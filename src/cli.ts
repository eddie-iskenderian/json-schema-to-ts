#!/usr/bin/env node

import {whiteBright} from 'cli-color'
import {JSONSchema4} from 'json-schema'
import minimist = require('minimist')
import {readdir, readFile, writeFile} from 'mz/fs'
import {resolve} from 'path'
import * as _ from 'lodash';
import {compile, Options} from './index'

main(
  minimist(process.argv.slice(2), {
    alias: {
      help: ['h'],
      input: ['i'],
      output: ['o']
    }
  })
)

async function main(argv: minimist.ParsedArgs) {
  if (argv.help) {
    printHelp()
    process.exit(0)
  }

  const argIn: string = argv._[0] || argv.input;
  const argOut: string = argv._[1] || argv.output
  if (!argIn || !argOut) {
    process.exit(1)
  }

  try {
    const options: Partial<Options> = _.extend(argv, { declareExternallyReferenced: false, style: { printWidth: 80 }, cwd: argIn });
    const ts: string[] = []
    const schemas = await readdir(argIn);
    for (const schema of schemas) {
      const jsonSchema: JSONSchema4 = JSON.parse(await readInput(`${ argIn }/${ schema }`));
      const tsDef = await compile(jsonSchema, argIn, options);
      ts.push(tsDef);
      // Null the banner comment after the first schema type definition
      options.bannerComment = '';
    }
    await writeOutput(ts.join(`\n`), argOut);
  } catch (e) {
    process.exit(1)
  }
}

async function readInput(argIn: string): Promise<string> {
  return await readFile(resolve(process.cwd(), argIn), 'utf-8')
}

async function writeOutput(ts: string, argOut: string): Promise<void> {
  if (!argOut) {
    try {
      process.stdout.write(ts)
      return Promise.resolve()
    } catch (err) {
      return Promise.reject(err)
    }
  }
  return writeFile(argOut, ts)
}

function printHelp() {
  const pkg = require('../../package.json')

  process.stdout.write(
    `
${pkg.name} ${pkg.version}
Usage: json2ts [--input, -i] [IN_FILE] [--output, -o] [OUT_FILE] [OPTIONS]

With no IN_FILE, or when IN_FILE is -, read standard input.
With no OUT_FILE and when IN_FILE is specified, create .d.ts file in the same directory.
With no OUT_FILE nor IN_FILE, write to standard output.

You can use any of the following options by adding them at the end.
Boolean values can be set to false using the 'no-' prefix.

  --cwd=XXX
      Root directory for resolving $ref
  --style.XXX=YYY
      Prettier configuration
`
  )
}
