import test from 'ava'
import {readdirSync} from 'fs'
import {template} from 'lodash'
import {join} from 'path'
import {JSONSchema4} from 'json-schema'
import {normalize} from '../src/normalizer'

interface JSONTestCase {
  name: string
  in: JSONSchema4
  out: JSONSchema4
}

const normalizerDir = __dirname + '/../../test/normalizer'

export function run() {
  readdirSync(normalizerDir)
    .filter(_ => /^.*\.json$/.test(_))
    .map(_ => join(normalizerDir, _))
    .map(_ => [_, require(_)] as [string, JSONTestCase])
    .forEach(([filename, json]: [string, JSONTestCase]) => {
      const params = {filename}
      test(json.name, t => {
        const normalised = normalize(json.in, filename)
        t.snapshot(template(toString(normalised))(params))
        t.deepEqual(json.out, normalised)
      })
    })
}

function toString(json: Record<string, any>): string {
  return JSON.stringify(json, null, 2)
}
