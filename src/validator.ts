import {JSONSchema4} from 'json-schema'
import {mapDeep} from './utils'

type Rule = (schema: JSONSchema4) => boolean | void
const rules = new Map<string, Rule>()

rules.set('When both maxItems and minItems are present, maxItems >= minItems', schema => {
  const {maxItems, minItems} = schema
  if (typeof maxItems === 'number' && typeof minItems === 'number') {
    return maxItems >= minItems
  }
})

rules.set('When maxItems exists, maxItems >= 0', schema => {
  const {maxItems} = schema
  if (typeof maxItems === 'number') {
    return maxItems >= 0
  }
})

rules.set('When minItems exists, minItems >= 0', schema => {
  const {minItems} = schema
  if (typeof minItems === 'number') {
    return minItems >= 0
  }
})

export function validate(schema: JSONSchema4, filename: string): string[] {
  const errors: string[] = []
  rules.forEach((rule, ruleName) => {
    mapDeep(schema, (schema, key) => {
      if (rule(schema) === false) {
        errors.push(`Error at key "${key}" in file "${filename}": ${ruleName}`)
      }
      return schema
    })
  })
  return errors
}
