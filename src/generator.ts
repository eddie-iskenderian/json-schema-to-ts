import { omit } from 'lodash';
import { DEFAULT_OPTIONS, Options } from './index';
import {
  AST,
  ASTWithStandaloneName,
  hasComment,
  hasStandaloneName,
  TArray,
  TInterface,
  TIntersection,
  TNamedInterface,
  TUnion,
  AST_TYPE,
  TEnumAsUnion,
  TLiteral,
  hasInternalStandaloneName
} from './types/AST';
import { toSafeString } from './utils';

export function generate(ast: AST, options: Options = DEFAULT_OPTIONS): string {
  return (
    [
      options.bannerComment,
      declareNamedTypes(ast, options, ast.standaloneName!),
      declareNamedInterfaces(ast, options, ast.standaloneName!)
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}

function declareNamedInterfaces(ast: AST, options: Options, rootASTName: string, processed: Set<AST> = new Set<AST>()): string {
  if (processed.has(ast)) {
    return '';
  }
  processed.add(ast);

  switch (ast.type) {
    case 'ARRAY':
      return declareNamedInterfaces((ast as TArray).params, options, rootASTName, processed);
    case 'INTERFACE':
      return [
        hasStandaloneName(ast) && ast.standaloneName === rootASTName && generateStandaloneInterface(ast, options)
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return '';
  }
}

function declareNamedTypes(ast: AST, options: Options, rootASTName: string, processed: Set<AST> = new Set<AST>()): string {
  if (processed.has(ast)) {
    return '';
  }
  processed.add(ast);

  switch (ast.type) {
    case 'ARRAY':
      return [
        declareNamedTypes(ast.params, options, rootASTName, processed),
        hasStandaloneName(ast) ? generateStandaloneType(ast, options) : undefined
      ]
        .filter(Boolean)
        .join('\n');
    case 'INTERFACE':
      return hasStandaloneName(ast) && ast.standaloneName !== rootASTName ? generateStandaloneInterface(ast, options) : '';
    case 'INTERSECTION':
      return hasStandaloneName(ast) ? generateStandaloneIntersection(ast, options) : '';
    case 'UNION':
      return hasStandaloneName(ast) ?
        generateUnionChildren(ast, options, rootASTName) + `\n` +
        generateStandaloneUnion(ast) :
        '';
    case 'TUPLE':
      return [
        hasStandaloneName(ast) ? generateStandaloneType(ast, options) : undefined,
        ast.params
          .map(param => declareNamedTypes(param, options, rootASTName, processed))
          .filter(Boolean)
          .join('\n')
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return hasStandaloneName(ast) ? generateStandaloneType(ast, options) : '';
  }
}

function generateType(ast: AST, options: Options): string {
  return generateRawType(ast, options);
}

function generateRawType(ast: AST, options: Options): string {
  if (hasStandaloneName(ast)) {
    return toSafeString(ast.standaloneName);
  }

  switch (ast.type) {
    case 'ARRAY':
      const type = generateType(ast.params, options);
      return type.endsWith('"') ? '(' + type + ')[]' : type + '[]';
    case 'BOOLEAN':
      return 'boolean';
    case 'INTERFACE':
      return generateInterfaceMembers(ast, options);
    case 'INTERSECTION': {
      return generateIntersectionMembers(ast, options);
    }
    case 'LITERAL':
      return JSON.stringify(ast.params);
    case 'NUMBER':
      return 'number';
    case 'NULL':
      return 'null';
    case 'OBJECT':
      return 'object';
    case 'REFERENCE':
      return ast.params;
    case 'STRING':
      return 'string';
    case 'TUPLE':
    {
        const minItems = ast.minItems;
        const astParams = [...ast.params];
        const paramsList = astParams.map(param => generateType(param, options));

        const paramsToString = (params: string[]): string => '[' + params.join(', ') + ']';

        if (minItems >= paramsList.length) {
          throw 'Min tupple length must be smaller than the number items defined';
        }
        // if there are more items than the min, we return a union of tuples instead of
        // using the optional element operator. This is done because it is more typesafe.

        // union of tuples
        // type B = [string] | [string, string] | [string, string, string]
        // const b: B = ['a', undefined, 'c'] // TS error
        const cumulativeParamsList: string[] = paramsList.slice(0, minItems);
        const typesToUnion: string[] = [];

        if (cumulativeParamsList.length > 0) {
          // actually has minItems, so add the initial state
          typesToUnion.push(paramsToString(cumulativeParamsList));
        } else {
          // no minItems means it's acceptable to have an empty tuple type
          typesToUnion.push(paramsToString([]));
        }
        for (let i = minItems; i < paramsList.length; i += 1) {
          cumulativeParamsList.push(paramsList[i]);
          typesToUnion.push(paramsToString(cumulativeParamsList));
        }
        return typesToUnion.join('|');
    }
    case 'UNION':
      return generateUnionMembers(ast);
    case 'ENUM':
      return generateEnumMembers(ast);
    default:
      throw `Unknown AST type.`;
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
 * Generate the definitions of each child of the union that has not been
 * explicitly declared.
 */
function generateUnionChildren(ast: TUnion, options: Options, rootASTName: string): string {
  return ast.params.map(_ => {
    return hasInternalStandaloneName(_) ? declareNamedTypes(_, options, rootASTName) + '\n' : '';
  }).filter(t => !!t).join(`\n`);
}

/**
 * Generate an enum
 */
function generateEnumMembers(ast: TEnumAsUnion): string {
  const members = ast.params.map(_ => {
    expectAstType(_, 'LITERAL');
    const literal: TLiteral = _ as TLiteral;
    if (typeof literal.params === 'string') {
      return `"${ literal.params }"`;
    } else if (typeof literal.params === 'number' || typeof literal.params === 'boolean') {
      return `${ literal.params }`;
    } else {
      throw `Enum items must be of type 'string', 'number' or 'boolean'`;
    }
  });
  return members.join(`|`);
}

/**
 * Generate a union
 */
function generateUnionMembers(ast: TUnion): string {
  const members = ast.params.map(_ => {
    if (_.type === 'NULL') {
      return 'null';
    }
    if (!hasStandaloneName(_)) {
      throw `'AnyOf' and 'OneOf' entities can only reference named interfaces.`;
    }
    return toSafeString(_.standaloneName);
  });
  // Put 'null' at the end to indicate nullable types
  return members.sort((a, _b) => a === 'null' ? 1 : -1).join(`|`);
}

/**
 * Generate interface members of an intersection
 */
function generateIntersectionMembers(ast: TIntersection, options: Options): string {
  const members: string = generateIntersectionInterfaceMembers(ast, options);
  const refs: string = generateIntersectionRefMembers(ast);

  let result: string;
  if (members.length > 0 && refs.length > 0) {
    result = `${ wrapInterface(members) }\n& ${ refs }`;
  } else if (members.length > 0) {
    result = wrapInterface(members);
  } else if (refs.length > 0) {
    result = refs;
  } else {
    throw 'No members';
  }
  return result;
}

/**
 * Generate interface members of an intersection
 */
function generateIntersectionInterfaceMembers(ast: TIntersection, options: Options): string {
  const members = ast.params.filter(m => !m.standaloneName).map(_ => {
    expectAstType(_, 'INTERFACE');
    return generateInterfaceMembers(_ as TInterface, options);
  });
  return members.join(`,\n`);
}

/**
 * Generate reference members of an intersection
 */
function generateIntersectionRefMembers(ast: TIntersection): string {
  const refs = ast.params.filter(m => !!m.standaloneName).map(_ => {
    return toSafeString(_.standaloneName!);
  });
  return refs.join(`&`);
}

/**
 * Generate parameters required for the initialiser of an intersection type
 */
function generateIntersectionInitialiserParams(ast: TIntersection, options: Options): string {
  const members: string = generateIntersectionInterfaceInitialiserParams(ast, options);
  const refs: string = generateIntersectionRefInitialiserParams(ast);

  let result: string;
  if (members.length > 0 && refs.length > 0) {
    result = `${ wrapInterface(members) }\n& ${ refs }`;
  } else if (members.length > 0) {
    result = wrapInterface(members);
  } else if (refs.length > 0) {
    result = refs;
  } else {
    throw 'No members';
  }
  return result;
}

/**
 * Generate interface parameters required for the initialiser of an intersection type
 */
function generateIntersectionInterfaceInitialiserParams(ast: TIntersection, options: Options): string {
  const members = ast.params.filter(m => !m.standaloneName).map(_ => {
    expectAstType(_, 'INTERFACE');
    const intrface: TInterface = _ as TInterface;
    return generateInterfaceInitialiserParams(intrface, options);
  });
  return members.join(`,\n`);
}

/**
 * Generate reference parameters required for the initialiser of an intersection type
 */
function generateIntersectionRefInitialiserParams(ast: TIntersection): string {
  const refs = ast.params.filter(m => !!m.standaloneName).map(_ => {
    return toSafeString(_.standaloneName!);
  });
  return refs.join(`&`);
}

/**
 * Generate the assignments required for the initialiser of an intersection type
 */
function generateIntersectionInitialiserAssignments(ast: TIntersection): string {
  const members: string = generateIntersectionInterfaceInitialiserAssignments(ast);
  const refs: string = generateIntersectionRefInitialiserAssignments(ast);

  let result: string;
  if (members.length > 0 && refs.length > 0) {
    result = `Object.assign(${ wrapInterface(members) }\n,${ refs })`;
  } else if (members.length > 0) {
    result = wrapInterface(members);
  } else if (refs.length > 0) {
    result = refs;
  } else {
    throw 'No members';
  }
  return result;
}

/**
 * Generate interface assignments required for the initialiser of an intersection type
 */
function generateIntersectionInterfaceInitialiserAssignments(ast: TIntersection): string {
  const members = ast.params.filter(m => !m.standaloneName).map(_ => {
    expectAstType(_, 'INTERFACE');
    const intrface: TInterface = _ as TInterface;
    return generateInterfaceInitialiserAssignments(intrface);
  });
  return members.join(`,\n`);
}

/**
 * Generate reference assignments required for the initialiser of an intersection type
 */
function generateIntersectionRefInitialiserAssignments(ast: TIntersection): string {
  const refs = ast.params.filter(m => !!m.standaloneName).map(_ => {
    return `make${ toSafeString(_.standaloneName!) }(input)`;
  });
  return refs.join(`,`);
}

function wrapInterface(rendered: string) {
  return `{\n${ rendered }\n}`;
}

function generateInterfaceMembers(iface: TInterface, options: Options): string {
  return (
    iface.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(
        ({isRequired, keyName, ast, isNullable}) =>
          [isRequired, keyName, ast, isNullable, generateType(ast, options)] as [boolean, string, AST, boolean, string]
      )
      .map(
        ([isRequired, keyName, ast, isNullable, type]) =>
          (hasComment(ast) ? generateComment(ast.comment) + '\n' : '') +
          escapeKeyName(keyName) +
          (isRequired ? '' : '?') +
          ': ' +
          `${ (hasStandaloneName(ast) ? toSafeString(type) : type) }${ isNullable ? '| null' : '' }`
      )
      .join('\n')
  );
}

function wrapInterfaceInitialiserParams(rendered: string, omitBraces: boolean = false): string {
  return `(\ninput: ${ omitBraces ? '' : '{' }\n${ rendered }\n${ omitBraces ? '' : '}' })`;
}

function generateInterfaceInitialiserParams(iface: TInterface, options: Options): string {
  return (
    iface.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(
        ({isRequired, keyName, ast, isNullable}) =>
          [isRequired, keyName, ast, isNullable, generateType(ast, options)] as [boolean, string, AST, boolean, string]
      )
      .map(
        ([isRequired, keyName, ast, isNullable, type]) =>
          escapeKeyName(keyName) +
          (isRequired ? '' : '?') +
          ': ' +
          `${ (hasStandaloneName(ast) ? toSafeString(type) : type) }${ isNullable ? '| null' : '' }`
      )
      .join(',\n')
  );
}

function wrapInterfaceInitialiserAssignments(rendered: string, omitBraces: boolean = false): string {
  const retur = `(${ omitBraces ? '' : '{' }\n${ rendered }\n${ omitBraces ? '' : '}'})`;
  return retur;
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
  );
}

function generateComment(comment: string): string {
  return ['/**', ...comment.split('\n').map(_ => ' * ' + _), ' */'].join('\n');
}

function generateStandaloneInterface(ast: TNamedInterface, options: Options): string {
  return (
    (hasComment(ast) ? generateComment(ast.comment) + '\n' : '') +
    `export interface ${toSafeString(ast.standaloneName)} ` +
    wrapInterface(generateInterfaceMembers(ast, options)) +
    `\n\nexport const make${ toSafeString(ast.standaloneName) } = ` +
    `${ wrapInterfaceInitialiserParams(generateInterfaceInitialiserParams(ast, options)) }: ${ toSafeString(ast.standaloneName) } =>` +
    `${ wrapInterfaceInitialiserAssignments(generateInterfaceInitialiserAssignments(ast)) };`
  );
}

function generateStandaloneIntersection(ast: ASTWithStandaloneName, options: Options): string {
  const intersection: TIntersection = ast as TIntersection;
  return (
    `${ hasComment(ast) ? generateComment(ast.comment) + '\n' : '' }` +
    `export type ${ toSafeString(ast.standaloneName)} = ${ generateIntersectionMembers(intersection, options) }` +
    `\n\n` +
    `export const make${ toSafeString(ast.standaloneName) } = ` +
    `${ wrapInterfaceInitialiserParams(generateIntersectionInitialiserParams(intersection, options), true) }: ${ toSafeString(ast.standaloneName) } =>` +
    `${ wrapInterfaceInitialiserAssignments(generateIntersectionInitialiserAssignments(intersection), true) };`
  );
}

function generateStandaloneUnion(ast: ASTWithStandaloneName): string {
  const union: TUnion = ast as TUnion;
  return (
    `${ hasComment(ast) ? generateComment(ast.comment) + '\n' : '' }` +
    `export type ${ toSafeString(ast.standaloneName)} = ${ generateUnionMembers(union) };\n\n`
  );
}

function generateStandaloneType(ast: ASTWithStandaloneName, options: Options): string {
  return (
    (hasComment(ast) ? generateComment(ast.comment) + '\n' : '') +
    `export type ${toSafeString(ast.standaloneName)} = ${generateType(
      omit<AST>(ast, 'standaloneName') as AST /* TODO */,
      options
    )};`
  );
}

function escapeKeyName(keyName: string): string {
  if (keyName.length && /[A-Za-z_$]/.test(keyName.charAt(0)) && /^[\w$]+$/.test(keyName)) {
    return keyName;
  }
  return JSON.stringify(keyName);
}
