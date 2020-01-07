import {whiteBright} from 'cli-color'
import {omit} from 'lodash'
import {DEFAULT_OPTIONS, Options} from './index'
import {
  AST,
  ASTWithStandaloneName,
  hasComment,
  hasStandaloneName,
  T_ANY,
  TArray,
  TEnum,
  TInterface,
  TIntersection,
  TNamedInterface,
  TUnion,
  AST_TYPE
} from './types/AST'
import {log, toSafeString} from './utils'

export function generate(ast: AST, options = DEFAULT_OPTIONS): string {
  return (
    [
      options.bannerComment,
      declareNamedTypes(ast, options, ast.standaloneName!),
      declareNamedInterfaces(ast, options, ast.standaloneName!),
      declareEnums(ast, options)
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  ) // trailing newline
}

function declareEnums(ast: AST, options: Options, processed = new Set<AST>()): string {
  if (processed.has(ast)) {
    return ''
  }

  processed.add(ast)
  let type = ''

  switch (ast.type) {
    case 'ENUM':
      type = generateStandaloneEnum(ast, options) + '\n'
      break
    case 'ARRAY':
      return declareEnums(ast.params, options, processed)
    case 'TUPLE':
      type = ast.params.reduce((prev, ast) => prev + declareEnums(ast, options, processed), '')
      if (ast.spreadParam) {
        type += declareEnums(ast.spreadParam, options, processed)
      }
      break
    case 'INTERFACE':
      type = getSuperTypesAndParams(ast).reduce((prev, ast) => prev + declareEnums(ast, options, processed), '')
      break
    default:
      return ''
  }

  return type
}

function declareNamedInterfaces(ast: AST, options: Options, rootASTName: string, processed = new Set<AST>()): string {
  if (processed.has(ast)) {
    return ''
  }

  processed.add(ast)
  let type = ''

  switch (ast.type) {
    case 'ARRAY':
      type = declareNamedInterfaces((ast as TArray).params, options, rootASTName, processed)
      break
    case 'INTERFACE':
      console.log("Standalone interface", ast.standaloneName)
      type = [
        hasStandaloneName(ast) &&
          (ast.standaloneName === rootASTName || options.declareExternallyReferenced) &&
          generateStandaloneInterface(ast, options),
        getSuperTypesAndParams(ast)
          .map(ast => declareNamedInterfaces(ast, options, rootASTName, processed))
          .filter(Boolean)
          .join('\n')
      ]
        .filter(Boolean)
        .join('\n')
      break
    default:
      type = ''
  }

  return type
}

function declareNamedTypes(ast: AST, options: Options, rootASTName: string, processed = new Set<AST>()): string {
  if (processed.has(ast)) {
    return ''
  }

  processed.add(ast)
  let type = ''

  switch (ast.type) {
    case 'ARRAY':
      type = [
        declareNamedTypes(ast.params, options, rootASTName, processed),
        hasStandaloneName(ast) ? generateStandaloneType(ast, options) : undefined
      ]
        .filter(Boolean)
        .join('\n')
      break
    case 'ENUM':
      type = ''
      break
    case 'INTERFACE':
      type = ''
      break
    case 'INTERSECTION':
      type = hasStandaloneName(ast) ? generateStandaloneIntersection(ast, options) : ''
      break
    case 'UNION':
      type = hasStandaloneName(ast) ? generateStandaloneUnion(ast) : ''
      break
    case 'TUPLE':
      type = [
        hasStandaloneName(ast) ? generateStandaloneType(ast, options) : undefined,
        ast.params
          .map(ast => declareNamedTypes(ast, options, rootASTName, processed))
          .filter(Boolean)
          .join('\n'),
        'spreadParam' in ast && ast.spreadParam
          ? declareNamedTypes(ast.spreadParam, options, rootASTName, processed)
          : undefined
      ]
        .filter(Boolean)
        .join('\n')
      break
    default:
      if (hasStandaloneName(ast)) {
        type = generateStandaloneType(ast, options)
      }
  }
  return type
}

function generateType(ast: AST, options: Options): string {
  const type = generateRawType(ast, options)

  if (options.strictIndexSignatures && ast.keyName === '[k: string]') {
    return `${type} | undefined`
  }

  return type
}

function generateRawType(ast: AST, options: Options): string {
  log(whiteBright.bgMagenta('generator'), ast)

  if (hasStandaloneName(ast)) {
    return toSafeString(ast.standaloneName)
  }

  switch (ast.type) {
    case 'ANY':
      return 'any'
    case 'ARRAY':
      return (() => {
        const type = generateType(ast.params, options)
        return type.endsWith('"') ? '(' + type + ')[]' : type + '[]'
      })()
    case 'BOOLEAN':
      return 'boolean'
    case 'INTERFACE':
      return generateInterfaceMembers(ast, options)
    case 'INTERSECTION': {
      return generateIntersectionMembers(ast, options);
    }
    case 'LITERAL':
      return JSON.stringify(ast.params)
    case 'NUMBER':
      return 'number'
    case 'NULL':
      return 'null'
    case 'OBJECT':
      return 'object'
    case 'REFERENCE':
      return ast.params
    case 'STRING':
      return 'string'
    case 'TUPLE':
      return (() => {
        const minItems = ast.minItems
        const maxItems = ast.maxItems || -1

        let spreadParam = ast.spreadParam
        const astParams = [...ast.params]
        if (minItems > 0 && minItems > astParams.length && ast.spreadParam === undefined) {
          // this is a valid state, and JSONSchema doesn't care about the item type
          if (maxItems < 0) {
            // no max items and no spread param, so just spread any
            spreadParam = T_ANY
          }
        }
        if (maxItems > astParams.length && ast.spreadParam === undefined) {
          // this is a valid state, and JSONSchema doesn't care about the item type
          // fill the tuple with any elements
          for (let i = astParams.length; i < maxItems; i += 1) {
            astParams.push(T_ANY)
          }
        }

        function addSpreadParam(params: string[]): string[] {
          if (spreadParam) {
            const spread = '...(' + generateType(spreadParam, options) + ')[]'
            params.push(spread)
          }
          return params
        }

        function paramsToString(params: string[]): string {
          return '[' + params.join(', ') + ']'
        }

        const paramsList = astParams.map(param => generateType(param, options))

        if (paramsList.length > minItems) {
          /*
        if there are more items than the min, we return a union of tuples instead of
        using the optional element operator. This is done because it is more typesafe.

        // optional element operator
        type A = [string, string?, string?]
        const a: A = ['a', undefined, 'c'] // no error

        // union of tuples
        type B = [string] | [string, string] | [string, string, string]
        const b: B = ['a', undefined, 'c'] // TS error
        */

          const cumulativeParamsList: string[] = paramsList.slice(0, minItems)
          const typesToUnion: string[] = []

          if (cumulativeParamsList.length > 0) {
            // actually has minItems, so add the initial state
            typesToUnion.push(paramsToString(cumulativeParamsList))
          } else {
            // no minItems means it's acceptable to have an empty tuple type
            typesToUnion.push(paramsToString([]))
          }

          for (let i = minItems; i < paramsList.length; i += 1) {
            cumulativeParamsList.push(paramsList[i])

            if (i === paramsList.length - 1) {
              // only the last item in the union should have the spread parameter
              addSpreadParam(cumulativeParamsList)
            }

            typesToUnion.push(paramsToString(cumulativeParamsList))
          }

          return typesToUnion.join('|')
        }

        // no max items so only need to return one type
        return paramsToString(addSpreadParam(paramsList))
      })()
    case 'UNION':
      return generateUnionMembers(ast)
    case 'CUSTOM_TYPE':
      return ast.params
  }
}

/**
 * Check the AST type and throws when a type other than the expected type encountered
 */
function expectAstType(ast: AST, type: AST_TYPE) {
  if (ast.type !== type) {
    throw `Expected an AST type of '${ type }', but received a '${ ast.type }'`;
  }
}

/**
 * Generate a union
 */
function generateUnionMembers(ast: TUnion): string {
  const members = ast.params.map(_ => {
    if (!hasStandaloneName(_)) {
      throw `'AnyOf' and 'OneOf' entities can only reference named interfaces.`
    }
    return toSafeString(_.standaloneName);
  });
  return members.length === 1 ? members[0] : members.join(`|`);
}

/**
 * Generate an intersection
 */
function generateIntersectionMembers(ast: TIntersection, options: Options): string {
  const members = ast.params.map(_ => {
    expectAstType(_, 'INTERFACE')
    return generateInterfaceMembers(_ as TInterface, options);
  });
  return members.length === 1 ? members[0] : members.join(`\n`);
}

/**
 * Generate the parameters required for the initialiser of an intersection type
 */
function generateIntersectionInitialiserParams(ast: TIntersection, options: Options): string {
  return (
    ast.params.map(_ => {
      expectAstType(_, 'INTERFACE')
      const intrface: TInterface = _ as TInterface;
      return generateInitialiserParams(intrface, options);
    })
    .join(`,\n`)
  );
}

/**
 * Generate the assignments required for the initialiser of an intersection type
 */
function generateIntersectionInitialiserAssignments(ast: TIntersection): string {
  return (
    ast.params.map(_ => {
      expectAstType(_, 'INTERFACE')
      const intrface: TInterface = _ as TInterface;
      return generateInterfaceInitialiserAssignments(intrface);
    })
    .join(`,\n`)
  );
}

function wrapInterface(rendered: string) {
  return `{\n${ rendered }\n}`
}

function generateInterfaceMembers(ast: TInterface, options: Options): string {
  return (
    ast.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(
        ({isRequired, keyName, ast}) =>
          [isRequired, keyName, ast, generateType(ast, options)] as [boolean, string, AST, string]
      )
      .map(
        ([isRequired, keyName, ast, type]) =>
          (hasComment(ast) && !ast.standaloneName ? generateComment(ast.comment) + '\n' : '') +
          escapeKeyName(keyName) +
          (isRequired ? '' : '?') +
          ': ' +
          (hasStandaloneName(ast) ? toSafeString(type) : type)
      )
      .join('\n')
  )
}

function wrapInterfaceInitialiserParams(rendered: string, omitBraces: boolean = false): string {
  return `(\ninput: ${ omitBraces ? '' : '{' }\n${ rendered }\n${ omitBraces ? '' : '}' })`;
}

function generateInitialiserParams(ast: TInterface, options: Options): string {
  return (
    ast.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(
        ({isRequired, keyName, ast}) =>
          [isRequired, keyName, ast, generateType(ast, options)] as [boolean, string, AST, string]
      )
      .map(
        ([isRequired, keyName, ast, type]) =>
          escapeKeyName(keyName) +
          (isRequired ? '' : '?') +
          ': ' +
          (hasStandaloneName(ast) ? toSafeString(type) : type)
      )
      .join(',\n')
  )
}

function wrapInterfaceInitialiserAssignments(rendered: string): string {
  return `({\n${ rendered }\n})`;
}

function generateInterfaceInitialiserAssignments(rootAst: TInterface): string {
  return (
    rootAst.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(param => 
        `${ escapeKeyName(param.keyName) }: ` +
        (param.isRequired ? `input.${ escapeKeyName(param.keyName) }` : `input.${ escapeKeyName(param.keyName) } === undefined ? ${ param.default } : input.${ escapeKeyName(param.keyName) }`)
      )
      .join(',\n')
  )
}

function generateComment(comment: string): string {
  return ['/**', ...comment.split('\n').map(_ => ' * ' + _), ' */'].join('\n')
}

function generateStandaloneEnum(ast: TEnum, options: Options): string {
  return (
    (hasComment(ast) ? generateComment(ast.comment) + '\n' : '') +
    'export ' +
    (options.enableConstEnums ? 'const ' : '') +
    `enum ${toSafeString(ast.standaloneName)} {` +
    '\n' +
    ast.params.map(({ast, keyName}) => keyName + ' = ' + generateType(ast, options)).join(',\n') +
    '\n' +
    '}'
  )
}

function generateStandaloneInterface(ast: TNamedInterface, options: Options): string {
  return (
    (hasComment(ast) ? generateComment(ast.comment) + '\n' : '') +
    `export interface ${toSafeString(ast.standaloneName)} ` +
    (ast.superTypes.length > 0
      ? `extends ${ast.superTypes.map(superType => toSafeString(superType.standaloneName)).join(', ')} `
      : '') +
    wrapInterface(generateInterfaceMembers(ast, options)) +
    `\n\nexport const make${ toSafeString(ast.standaloneName) } = ` +
    `${ wrapInterfaceInitialiserParams(generateInitialiserParams(ast, options)) }: ${ toSafeString(ast.standaloneName) } =>` +
    `${ wrapInterfaceInitialiserAssignments(generateInterfaceInitialiserAssignments(ast)) };`
  )
}

function generateStandaloneIntersection(ast: ASTWithStandaloneName, options: Options): string {
  const intersection: TIntersection = ast as TIntersection;
  return (
    `${ hasComment(ast) ? generateComment(ast.comment) + '\n' : '' }` +
    `export interface ${ toSafeString(ast.standaloneName)} ${ wrapInterface(generateIntersectionMembers(intersection, options)) }` +
    `\n\n` +
    `export const make${ toSafeString(ast.standaloneName) } = ` +
    `${ wrapInterfaceInitialiserParams(generateIntersectionInitialiserParams(intersection, options)) }: ${ toSafeString(ast.standaloneName) } =>` +
    `${ wrapInterfaceInitialiserAssignments(generateIntersectionInitialiserAssignments(intersection)) };`
  );
}

function generateStandaloneUnion(ast: ASTWithStandaloneName): string {
  const union: TUnion = ast as TUnion;
  return (
    `${ hasComment(ast) ? generateComment(ast.comment) + '\n' : '' }` +
    `export type ${ toSafeString(ast.standaloneName)} = ${ generateUnionMembers(union) };\n`
  );
}

function generateStandaloneType(ast: ASTWithStandaloneName, options: Options): string {
  return (
    (hasComment(ast) ? generateComment(ast.comment) + '\n' : '') +
    `export type ${toSafeString(ast.standaloneName)} = ${generateType(
      omit<AST>(ast, 'standaloneName') as AST /* TODO */,
      options
    )}`
  )
}

function escapeKeyName(keyName: string): string {
  if (keyName.length && /[A-Za-z_$]/.test(keyName.charAt(0)) && /^[\w$]+$/.test(keyName)) {
    return keyName
  }
  if (keyName === '[k: string]') {
    return keyName
  }
  return JSON.stringify(keyName)
}

function getSuperTypesAndParams(ast: TInterface): AST[] {
  return ast.params.map(param => param.ast).concat(ast.superTypes)
}
