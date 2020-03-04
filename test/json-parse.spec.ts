import { readFileSync } from 'fs'
import { JSONSchema4 } from 'json-schema'
import { compile } from '../src/index'

beforeAll(() => {
});

beforeEach(() => {
});

const normaliseTypes = (types: string) => {
  return types.replace(/[\s]+/g, ' ');
};

const compareTypes = async (schema: string, expectType: string) => {
  const options = { cwd: 'test/json', declareExternallyReferenced: false, style: { printWidth: 80 } }
  const jsonSchema: JSONSchema4 = JSON.parse(readFileSync(`test/json/${ schema }`).toString());
  const typeDef = await compile(jsonSchema, 'test/json', options);
  console.log(typeDef);
  const typescript = normaliseTypes(expectType);
  expect(normaliseTypes(typeDef)).toContain(typescript);
};

describe('Generate Typescript types', () => {
  
  beforeAll(() => {
  });
  
  it('can generate allOf types', async () => {
    const typescript = `
      export type AllOf = {
        age?: number;
      } & Person;
    
      export const makeAllOf = (
        input: {
          age?: number;
        } & Person
      ): AllOf =>
        Object.assign(
          {
            age: input.age === undefined ? 0 : input.age
          },
          makePerson(input)
        );`;
    await compareTypes('all_of.json', typescript)
  });
  
  it('can generate allOf types with muliple `properties` components', async () => {
    const typescript = `
    export type AllOfNoOrder = {
      age?: number;
      hobby?: string;
    } & Person;
    
    export const makeAllOfNoOrder = (
      input: {
        age?: number;
        hobby?: string;
      } & Person
    ): AllOfNoOrder =>
      Object.assign(
        {
          age: input.age === undefined ? 0 : input.age,
          hobby: input.hobby === undefined ? "" : input.hobby
        },
        makePerson(input)
      );`;
    await compareTypes('all_of_with_multi_props.json', typescript)
  });
  
  it('can generate allOf types with multiple $ref components', async () => {
    const typescript = `
    export type AllOf1 = {
      age?: number;
    } & Person &
      Name;
    
    export const makeAllOf1 = (
      input: {
        age?: number;
      } & Person &
        Name
    ): AllOf1 =>
      Object.assign(
        {
          age: input.age === undefined ? 0 : input.age
        },
        makePerson(input),
        makeName(input)
      );`;
    await compareTypes('all_of_with_multi_refs.json', typescript)
  });
  
  it('can generate anyOf types', async () => {
    const typescript = `export type AnyOf = Name | Person;`;
    await compareTypes('any_of.json', typescript)
  });
  
  it('can generate types for arrays that contain $refs', async () => {
    const typescript = `
      export interface WithArrayRefs {
        array: Person[];
      }
    
      export const makeWithArrayRefs = (input: {array: Person[]}): WithArrayRefs => ({
        array: input.array
      });`;
    await compareTypes('array_with_refs.json', typescript)
  });
  
  it('can generate types for schemas with a combo of explicit types and $refs', async () => {
    const typescript = `
      export interface Employee {
        role?: string;
        person: Person;
      }
      
      export const makeEmployee = (input: {
        role?: string;
        person: Person;
      }): Employee => ({
        role: input.role === undefined ? "Engineer" : input.role,
        person: input.person
      });`;
    await compareTypes('schema_with_types_and_refs.json', typescript)
  });
  
  it('can generate enum types', async () => {
    const typescript = `export type Enum = "red " | "amber " | "green ";`;
    await compareTypes('enum.json', typescript)
  });
  
  it('can generate enum with mixed types', async () => {
    const typescript = `export type MixedEnum = "one " | 2 | "three " | true | false;`;
    await compareTypes('mixed_enum.json', typescript)
  });
  
  it('can generate oneOf types', async () => {
    const typescript = `export type OneOf = AllOf | Person;`;
    await compareTypes('one_of.json', typescript)
  });
  
  it('can generate tuple types', async () => {
    const typescript = `export interface WithTupleRefs {
      tuple:
        | []
        | [User]
        | [User, string]
        | [User, string, Name]
        | [User, string, Name, null];
    }
    
    export const makeWithTupleRefs = (input: {
      tuple:
        | []
        | [User]
        | [User, string]
        | [User, string, Name]
        | [User, string, Name, null];
    }): WithTupleRefs => ({
      tuple: input.tuple
    });`;
    await compareTypes('tuple_with_refs.json', typescript)
  });
  
  it('can generate array with size', async () => {
    const typescript = `
    export interface WithArraySize {
      array: [number, number] | [number, number, number];
    }
    
    export const makeWithArraySize = (input: {
      array: [number, number] | [number, number, number];
    }): WithArraySize => ({
      array: input.array
    });`;
    await compareTypes('array_with_size.json', typescript)
  });

  it('can fail with no members', async () => {
    try {
      await compareTypes('all_of_with_no_members.json', '')
      fail('Cannot have a allOf with no members');
    } catch (e) {
      expect(e).toEqual('No members');
    }
  });

  it('can fail type with wrong default type', async () => {
    try {
      await compareTypes('name_with_bad_default.json', '')
      fail('Cannot use a number default for a string member');
    } catch (e) {
      expect(e).toContain('not a valid default');
    }
  });

  it('can fail when a required field has no default', async () => {
    try {
      await compareTypes('name_with_not_req_but_no_default.json', '')
      fail('Cannot have a required field has no default');
    } catch (e) {
      expect(e).toContain('is not required but has no default');
    }
  });
  
  it('can generate type with a null default', async () => {
    const typescript = `
      export interface User {
        id?: number;
        flag?: boolean;
        age?: number;
        name?: Name;
      }
      
      export const makeUser = (input: {
        id?: number;
        flag?: boolean;
        age?: number;
        name?: Name;
      }): User => ({
        id: input.id === undefined ? 0 : input.id,
        flag: input.flag === undefined ? false : input.flag,
        age: input.age === undefined ? 16 : input.age,
        name: input.name === undefined ? null : input.name
      });`;
    await compareTypes('has_null_default.json', typescript)
  });

  it('can generate string types', async () => {
    const typescript = `export type String = string;`;
    await compareTypes('string.json', typescript)
  });
  
});