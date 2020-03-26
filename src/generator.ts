import {
  AST,
  ASTWithStandaloneName,
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

export function generate(ast: AST): string {
  return (
    [
      declareNamedTypes(ast, ast.standaloneName!),
      declareNamedInterfaces(ast, ast.standaloneName!)
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}

function declareNamedInterfaces(ast: AST, rootASTName: string, processed: Set<AST> = new Set<AST>()): string {
  if (processed.has(ast)) {
    return '';
  }
  processed.add(ast);

  switch (ast.type) {
    case 'ARRAY':
      return declareNamedInterfaces((ast as TArray).params, rootASTName, processed);
    case 'INTERFACE':
      return [
        hasStandaloneName(ast) && ast.standaloneName === rootASTName && generateStandaloneInterface(ast)
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return '';
  }
}

function declareNamedTypes(ast: AST, rootASTName: string, processed: Set<AST> = new Set<AST>()): string {
  if (processed.has(ast)) {
    return '';
  }
  processed.add(ast);

  switch (ast.type) {
    case 'ARRAY':
      return [declareNamedTypes(ast.params, rootASTName, processed)]
        .filter(Boolean)
        .join('\n');
    case 'INTERFACE':
      return hasStandaloneName(ast) && ast.standaloneName !== rootASTName ? generateStandaloneInterface(ast) : '';
    case 'INTERSECTION':
      return hasStandaloneName(ast) ? generateStandaloneIntersection(ast) : '';
    case 'UNION':
      return hasStandaloneName(ast) ?
        generateUnionChildren(ast, rootASTName) :
        '';
    case 'TUPLE':
      return [
        ast.params
          .map(param => declareNamedTypes(param, rootASTName, processed))
          .filter(Boolean)
          .join('\n')
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return '';
  }
}

function generateType(ast: AST): string {
  return generateRawType(ast);
}

function generateRawType(ast: AST): string {
  if (hasStandaloneName(ast)) {
    return toSafeString(ast.standaloneName);
  }

  switch (ast.type) {
    case 'ARRAY':
      const type = generateType(ast.params);
      return type.endsWith('"') ? '(' + type + ')[]' : type + '[]';
    case 'BOOLEAN':
      return 'boolean';
    case 'INTERFACE':
      return generateInterfaceMembers(ast);
    case 'INTERSECTION': {
      return generateIntersectionMembers(ast);
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
    case 'TUPLE': {
        const minItems = ast.minItems;
        const astParams = [...ast.params];
        const paramsList = astParams.map(param => generateType(param));

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
function generateUnionChildren(ast: TUnion, rootASTName: string): string {
  return ast.params.map(_ => {
    return hasInternalStandaloneName(_) ? declareNamedTypes(_, rootASTName) + '\n' : '';
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
function generateIntersectionMembers(ast: TIntersection): string {
  const members: string = generateIntersectionInterfaceMembers(ast);
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
function generateIntersectionInterfaceMembers(ast: TIntersection): string {
  const members = ast.params.filter(m => !m.standaloneName).map(_ => {
    expectAstType(_, 'INTERFACE');
    return generateInterfaceMembers(_ as TInterface);
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

function generateInterfaceMembers(iface: TInterface): string {
  return (
    iface.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(
        ({isRequired, keyName, ast, isNullable}) =>
          [isRequired, keyName, ast, isNullable, generateType(ast)] as [boolean, string, AST, boolean, string]
      )
      .map(
        ([isRequired, keyName, ast, isNullable, type]) =>
          escapeKeyName(keyName) +
          (isRequired ? '' : '?') +
          ': ' +
          `${ (hasStandaloneName(ast) ? toSafeString(type) : type) }${ isNullable ? '| null' : '' }`
      )
      .join('\n')
  );
}

function wrapInterfaceInitialiserAssignments(rendered: string, omitBraces: boolean = false): string {
  const retur = `(${ omitBraces ? '' : '{' }\n${ rendered }\n${ omitBraces ? '' : '}'})`;
  return retur;
}

function generateInterfaceInitialiserAssignments(rootAst: TInterface): string {
  const a = (
    rootAst.params
      .filter(_ => !_.isPatternProperty && !_.isUnreachableDefinition)
      .map(param => {
        const name: string = escapeKeyName(param.keyName);
        const input: string = param.ast.type === 'INTERFACE' ?
          `make${ hasStandaloneName(param.ast) ? toSafeString(param.ast.standaloneName) : '' }(${ `input.${ name }` })` :
              `input.${ escapeKeyName(param.keyName) }`;
        return param.isRequired ?
            `${ name }: ${ input }` :
              `${ name }: input.${ name } === undefined ? ${ param.default } : ${ param.isNullable && param.ast.type === 'INTERFACE' ?  `input.${ name } === null ? null : ${ input }` : input }`;
      })
      .join(',\n')
  );
  return a;
}

function generateStandaloneInterface(ast: TNamedInterface): string {
  return (
    `export const make${ toSafeString(ast.standaloneName) } = (input) => ` +
    `${ wrapInterfaceInitialiserAssignments(generateInterfaceInitialiserAssignments(ast)) };`
  );
}

function generateStandaloneIntersection(ast: ASTWithStandaloneName): string {
  const intersection: TIntersection = ast as TIntersection;
  return (
    `export const make${ toSafeString(ast.standaloneName) } = input =>` +
    `${ wrapInterfaceInitialiserAssignments(generateIntersectionInitialiserAssignments(intersection), true) };`
  );
}

function escapeKeyName(keyName: string): string {
  if (keyName.length && /[A-Za-z_$]/.test(keyName.charAt(0)) && /^[\w$]+$/.test(keyName)) {
    return keyName;
  }
  return JSON.stringify(keyName);
}
