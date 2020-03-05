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
    export type AllOfWithMultiProps = {
      age?: number;
      hobby?: string;
    } & Person;
    
    export const makeAllOfWithMultiProps = (
      input: {
        age?: number;
        hobby?: string;
      } & Person
    ): AllOfWithMultiProps =>
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
    export type AllOfWithMultiRefs = {
      age?: number;
    } & Person &
      Name;
    
    export const makeAllOfWithMultiRefs = (
      input: {
        age?: number;
      } & Person &
        Name
    ): AllOfWithMultiRefs =>
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
      export interface SchemaWithTypesAndRefs {
        role?: string;
        person: Person;
      }
      
      export const makeSchemaWithTypesAndRefs = (input: {
        role?: string;
        person: Person;
      }): SchemaWithTypesAndRefs => ({
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
      export interface HasNullDefault {
        id?: number;
        flag?: boolean;
        age?: number | null;
        name?: Name;
      }
      
      export const makeHasNullDefault = (input: {
        id?: number;
        flag?: boolean;
        age?: number | null;
        name?: Name;
      }): HasNullDefault => ({
        id: input.id === undefined ? 0 : input.id,
        flag: input.flag === undefined ? false : input.flag,
        age: input.age === undefined ? 16 : input.age,
        name: input.name === undefined ? null : input.name
      });`;
    await compareTypes('has_null_default.json', typescript)
  });

  it('can generate type with member types specified as arrays', async () => {
    const typescript = `
      export interface HasTypeArrays {
        id?: number;
        flag?: boolean;
        age?: number | null;
        name?: Name;
      }
      
      export const makeHasTypeArrays = (input: {
        id?: number;
        flag?: boolean;
        age?: number | null;
        name?: Name;
      }): HasTypeArrays => ({
        id: input.id === undefined ? 0 : input.id,
        flag: input.flag === undefined ? false : input.flag,
        age: input.age === undefined ? 16 : input.age,
        name: input.name === undefined ? null : input.name
      });`;
    await compareTypes('has_type_arrays.json', typescript)
  });

  it('can generate string types', async () => {
    const typescript = `
      export interface HasTypeArraysRefAndNulls {
        id?: Person;
      }
      
      export const makeHasTypeArraysRefAndNulls = (input: {
        id?: Person;
      }): HasTypeArraysRefAndNulls => ({
        id: input.id === undefined ? null : input.id
      });`;
      await compareTypes('has_type_arrays_ref_and_nulls.json', typescript)
  });

  it('can generate string types', async () => {
    const typescript = `export type String = string;`;
    await compareTypes('string.json', typescript)
  });

  it('can generate type with comments', async () => {
    const typescript = `
      /**
       * A person's name.
       */
      export interface Name {
        first: string;
        last: string;
      }
      
      export const makeName = (input: {first: string; last: string}): Name => ({
        first: input.first,
        last: input.last
      });`;
      await compareTypes('name_with_comment.json', typescript)
  });

  it('can fail on an unknown schema type', async () => {
    try {
      await compareTypes('unknown_schema_type.json', '')
      fail('Cannot have unsupported schema types');
    } catch (e) {
      expect(e).toContain('is an unsupported type.');
    }
  });

  it('can fail on an empty schema type', async () => {
    try {
      await compareTypes('has_empty_type_arrays.json', '')
      fail('Cannot have an empty schema types');
    } catch (e) {
      expect(e).toEqual('Type arrays must have at least one element');
    }
  });

  it('can fail on an invalid schema type', async () => {
    try {
      await compareTypes('has_invalid_type_arrays.json', '')
      fail('Cannot have an invalid schema types');
    } catch (e) {
      expect(e).toEqual('Type arrays with more than one element must have a null item.');
    }
  });

  it('can fail on an invalid schema type', async () => {
    try {
      await compareTypes('has_type_arrays_long_array.json', '')
      fail('Cannot have an invalid schema types');
    } catch (e) {
      expect(e).toEqual('Array type specifiers cannot contain more than 2 types.');
    }
  });

  it('can handle a null schema type', async () => {
    const typescript = `
      export interface HasTypeArraysWithNulls {
        id: null;
        flag: number;
      }
      
      export const makeHasTypeArraysWithNulls = (input: {
        id: null;
        flag: number;
      }): HasTypeArraysWithNulls => ({
        id: input.id,
        flag: input.flag
      });`;
      await compareTypes('has_type_arrays_with_nulls.json', typescript)
  });
});