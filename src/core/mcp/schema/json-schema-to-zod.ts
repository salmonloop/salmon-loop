import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, unknown>;
  patternProperties?: Record<string, unknown>;
  required?: string[];
  dependentRequired?: Record<string, string[]>;
  dependentSchemas?: Record<string, unknown>;
  prefixItems?: unknown[];
  items?: unknown;
  contains?: unknown;
  minItems?: number;
  maxItems?: number;
  minContains?: number;
  maxContains?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  enum?: unknown[];
  const?: unknown;
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  not?: unknown;
  if?: unknown;
  then?: unknown;
  else?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  additionalProperties?: boolean | unknown;
  propertyNames?: unknown;
  $ref?: string;
  $defs?: Record<string, unknown>;
  $anchor?: string;
}

export function jsonSchemaToZod(jsonSchema: unknown): z.ZodType<any> {
  return jsonSchemaToZodWithContext(jsonSchema, jsonSchema);
}

function jsonSchemaToZodWithContext(jsonSchema: unknown, rootSchema: unknown): z.ZodType<any> {
  if (jsonSchema === true) {
    return z.any();
  }

  if (jsonSchema === false) {
    return z.never();
  }

  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return z.any();
  }

  const schema = jsonSchema as JsonSchema;

  if (typeof schema.$ref === 'string') {
    const { $ref: _ref, ...siblings } = schema;
    return z.lazy(() => {
      const referencedSchema = resolveLocalRef(rootSchema, schema.$ref!);
      if (!referencedSchema) {
        return z.never();
      }
      return finalizeSchema(
        combineWithSiblingKeywords(
          jsonSchemaToZodWithContext(referencedSchema, rootSchema),
          siblings,
          rootSchema,
        ),
        schema,
        rootSchema,
      );
    });
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const { oneOf, ...siblings } = schema;
    return finalizeSchema(
      combineWithSiblingKeywords(oneOfToZod(oneOf, rootSchema), siblings, rootSchema),
      schema,
      rootSchema,
    );
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const { anyOf, ...siblings } = schema;
    return finalizeSchema(
      combineWithSiblingKeywords(unionToZod(anyOf, rootSchema), siblings, rootSchema),
      schema,
      rootSchema,
    );
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const { allOf, ...siblings } = schema;
    const hasSiblings = hasValidationKeywords(siblings);
    const schemasToMerge = hasSiblings ? [...allOf, siblings] : allOf;
    const parts = schemasToMerge.map((part) => jsonSchemaToZodWithContext(part, rootSchema));
    return finalizeSchema(
      parts.reduce((acc, part) => acc.and(part)),
      schema,
      rootSchema,
    );
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    const { const: _const, ...siblings } = schema;
    return finalizeSchema(
      combineWithSiblingKeywords(z.literal(schema.const as never), siblings, rootSchema),
      schema,
      rootSchema,
    );
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((value) => z.literal(value as never));
    const { enum: _enum, ...siblings } = schema;
    return finalizeSchema(
      combineWithSiblingKeywords(unionLiterals(literals), siblings, rootSchema),
      schema,
      rootSchema,
    );
  }

  if (Array.isArray(schema.type)) {
    const nullable = schema.type.includes('null');
    const nonNullTypes = schema.type.filter((type) => type !== 'null');
    if (nonNullTypes.length === 0 && nullable) {
      return finalizeSchema(z.null(), schema, rootSchema);
    }
    const typed = unionToZod(
      nonNullTypes.map((type) => ({ ...schema, type })),
      rootSchema,
    );
    return finalizeSchema(nullable ? typed.nullable() : typed, schema, rootSchema);
  }

  if (!schema.type) {
    const implicitSchema = buildImplicitTypeScopedSchema(schema, rootSchema);
    if (implicitSchema) {
      return implicitSchema;
    }
    return finalizeSchema(z.any(), schema, rootSchema);
  }

  switch (schema.type) {
    case 'string':
      return finalizeSchema(applyStringConstraints(z.string(), schema), schema, rootSchema);
    case 'number':
      return finalizeSchema(applyNumberConstraints(z.number(), schema), schema, rootSchema);
    case 'integer':
      return finalizeSchema(applyNumberConstraints(z.number().int(), schema), schema, rootSchema);
    case 'boolean':
      return finalizeSchema(z.boolean(), schema, rootSchema);
    case 'array':
      return finalizeSchema(
        applyArrayConstraints(arraySchemaToZod(schema, rootSchema), schema, rootSchema),
        schema,
        rootSchema,
      );
    case 'object':
    case undefined:
      return objectSchemaToZod(schema, rootSchema);
    case 'null':
      return finalizeSchema(z.null(), schema, rootSchema);
    default:
      return finalizeSchema(z.any(), schema, rootSchema);
  }
}

function objectSchemaToZod(schema: JsonSchema, rootSchema: unknown): z.ZodType<any> {
  const shape: Record<string, z.ZodType<any>> = {};
  const properties = schema.properties || {};
  const required = schema.required || [];
  const undeclaredRequired = required.filter(
    (key) => !Object.prototype.hasOwnProperty.call(properties, key),
  );

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema = jsonSchemaToZodWithContext(prop, rootSchema);
    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }

  const objectSchema = z.object(shape).passthrough();
  return finalizeSchema(
    applyRequiredProperties(
      applyObjectConstraints(objectSchema, schema, rootSchema),
      undeclaredRequired,
    ),
    schema,
    rootSchema,
  );
}

function applyStringConstraints(schema: z.ZodString, jsonSchema: JsonSchema): z.ZodType<string> {
  let constrained = schema;
  if (typeof jsonSchema.minLength === 'number') {
    constrained = constrained.min(jsonSchema.minLength);
  }
  if (typeof jsonSchema.maxLength === 'number') {
    constrained = constrained.max(jsonSchema.maxLength);
  }
  if (typeof jsonSchema.pattern === 'string') {
    constrained = constrained.regex(new RegExp(jsonSchema.pattern));
  }
  return constrained;
}

function applyNumberConstraints(schema: z.ZodNumber, jsonSchema: JsonSchema): z.ZodType<number> {
  let constrained = schema;
  if (typeof jsonSchema.minimum === 'number') {
    constrained = constrained.min(jsonSchema.minimum);
  }
  if (typeof jsonSchema.maximum === 'number') {
    constrained = constrained.max(jsonSchema.maximum);
  }
  if (typeof jsonSchema.exclusiveMinimum === 'number') {
    constrained = constrained.gt(jsonSchema.exclusiveMinimum);
  }
  if (typeof jsonSchema.exclusiveMaximum === 'number') {
    constrained = constrained.lt(jsonSchema.exclusiveMaximum);
  }
  if (typeof jsonSchema.multipleOf === 'number' && jsonSchema.multipleOf > 0) {
    constrained = constrained.refine(
      (value) => isMultipleOf(value, jsonSchema.multipleOf as number),
      `Expected a multiple of ${jsonSchema.multipleOf}`,
    );
  }
  return constrained;
}

function arraySchemaToZod(schema: JsonSchema, rootSchema: unknown): z.ZodArray<any> {
  if (Array.isArray(schema.prefixItems) && schema.prefixItems.length > 0) {
    const prefixSchemas = schema.prefixItems.map((itemSchema) =>
      jsonSchemaToZodWithContext(itemSchema, rootSchema),
    );
    const tailSchema =
      schema.items !== undefined ? jsonSchemaToZodWithContext(schema.items, rootSchema) : undefined;

    return z.array(z.any()).superRefine((items, ctx) => {
      items.forEach((item, index) => {
        if (index < prefixSchemas.length) {
          const result = prefixSchemas[index]?.safeParse(item);
          if (!result?.success) {
            for (const issue of result?.error.issues ?? []) {
              ctx.addIssue({
                ...issue,
                path: [index, ...issue.path],
              });
            }
          }
          return;
        }

        if (!tailSchema) return;
        const result = tailSchema.safeParse(item);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({
              ...issue,
              path: [index, ...issue.path],
            });
          }
        }
      });
    }) as z.ZodArray<any>;
  }

  const itemSchema =
    schema.items !== undefined ? jsonSchemaToZodWithContext(schema.items, rootSchema) : z.any();
  return z.array(itemSchema);
}

function buildImplicitTypeScopedSchema(
  schema: JsonSchema,
  rootSchema: unknown,
): z.ZodType<any> | undefined {
  const scopedSchemas: Array<{
    matches: (value: unknown) => boolean;
    schema: z.ZodType<any>;
  }> = [];

  if (hasObjectKeywords(schema)) {
    scopedSchemas.push({
      matches: isPlainObject,
      schema: objectSchemaToZod({ ...schema, type: 'object' }, rootSchema),
    });
  }
  if (hasArrayKeywords(schema)) {
    const arraySchema = { ...schema, type: 'array' as const };
    scopedSchemas.push({
      matches: Array.isArray,
      schema: finalizeSchema(
        applyArrayConstraints(arraySchemaToZod(arraySchema, rootSchema), arraySchema, rootSchema),
        arraySchema,
        rootSchema,
      ),
    });
  }
  if (hasStringKeywords(schema)) {
    const stringSchema = { ...schema, type: 'string' as const };
    scopedSchemas.push({
      matches: (value) => typeof value === 'string',
      schema: finalizeSchema(
        applyStringConstraints(z.string(), stringSchema),
        stringSchema,
        rootSchema,
      ),
    });
  }
  if (hasNumberKeywords(schema)) {
    const numberSchema = { ...schema, type: 'number' as const };
    scopedSchemas.push({
      matches: (value) => typeof value === 'number' && Number.isFinite(value),
      schema: finalizeSchema(
        applyNumberConstraints(z.number(), numberSchema),
        numberSchema,
        rootSchema,
      ),
    });
  }

  if (scopedSchemas.length === 0) {
    return undefined;
  }

  return finalizeSchema(
    z.any().superRefine((value, ctx) => {
      for (const scopedSchema of scopedSchemas) {
        if (!scopedSchema.matches(value)) continue;
        const result = scopedSchema.schema.safeParse(value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue });
          }
        }
      }
    }),
    schema,
    rootSchema,
  );
}

function applyArrayConstraints(
  schema: z.ZodArray<any>,
  jsonSchema: JsonSchema,
  rootSchema: unknown,
): z.ZodType<any[]> {
  let constrained = schema;
  if (typeof jsonSchema.minItems === 'number') {
    constrained = constrained.min(jsonSchema.minItems);
  }
  if (typeof jsonSchema.maxItems === 'number') {
    constrained = constrained.max(jsonSchema.maxItems);
  }
  if (jsonSchema.uniqueItems === true) {
    constrained = constrained.refine(
      (items) => hasUniqueItems(items),
      'Expected array items to be unique',
    );
  }
  if (jsonSchema.contains !== undefined) {
    const containsSchema = jsonSchemaToZodWithContext(jsonSchema.contains, rootSchema);
    constrained = constrained.refine((items) => {
      const matchCount = items.filter((item) => containsSchema.safeParse(item).success).length;
      const minContains = typeof jsonSchema.minContains === 'number' ? jsonSchema.minContains : 1;
      const maxContains =
        typeof jsonSchema.maxContains === 'number'
          ? jsonSchema.maxContains
          : Number.POSITIVE_INFINITY;
      return matchCount >= minContains && matchCount <= maxContains;
    }, 'Contains validation failed');
  }
  return constrained;
}

function applyObjectConstraints<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  jsonSchema: JsonSchema,
  rootSchema: unknown,
): z.ZodType<any> {
  let constrained = schema;
  const knownProperties = new Set(Object.keys(jsonSchema.properties ?? {}));
  if (typeof jsonSchema.minProperties === 'number') {
    constrained = constrained.refine(
      (value) => Object.keys(value as Record<string, unknown>).length >= jsonSchema.minProperties!,
      `Expected at least ${jsonSchema.minProperties} properties`,
    );
  }
  if (typeof jsonSchema.maxProperties === 'number') {
    constrained = constrained.refine(
      (value) => Object.keys(value as Record<string, unknown>).length <= jsonSchema.maxProperties!,
      `Expected at most ${jsonSchema.maxProperties} properties`,
    );
  }
  if (jsonSchema.propertyNames) {
    const propertyNameSchema = propertyNamesToZod(jsonSchema.propertyNames, rootSchema);
    constrained = constrained.refine(
      (value) =>
        Object.keys(value as Record<string, unknown>).every(
          (key) => propertyNameSchema.safeParse(key).success,
        ),
      'Property name validation failed',
    );
  }
  const patternSchemas =
    jsonSchema.patternProperties && typeof jsonSchema.patternProperties === 'object'
      ? Object.entries(jsonSchema.patternProperties).map(([pattern, valueSchema]) => ({
          pattern: new RegExp(pattern),
          schema: jsonSchemaToZodWithContext(valueSchema, rootSchema),
        }))
      : [];
  const additionalPropertySchema =
    jsonSchema.additionalProperties && typeof jsonSchema.additionalProperties === 'object'
      ? jsonSchemaToZodWithContext(jsonSchema.additionalProperties, rootSchema)
      : undefined;
  if (
    patternSchemas.length > 0 ||
    jsonSchema.additionalProperties === false ||
    additionalPropertySchema
  ) {
    constrained = constrained.superRefine((value, ctx) => {
      for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
        const matchingPatterns = patternSchemas.filter(({ pattern }) => pattern.test(key));
        for (const { schema: patternSchema } of matchingPatterns) {
          const result = patternSchema.safeParse(entryValue);
          if (!result.success) {
            for (const issue of result.error.issues) {
              ctx.addIssue({
                ...issue,
                path: [key, ...issue.path],
              });
            }
          }
        }

        if (knownProperties.has(key) || matchingPatterns.length > 0) {
          continue;
        }

        if (jsonSchema.additionalProperties === false) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Additional properties are not allowed',
          });
          continue;
        }

        if (!additionalPropertySchema) {
          continue;
        }

        const result = additionalPropertySchema.safeParse(entryValue);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({
              ...issue,
              path: [key, ...issue.path],
            });
          }
        }
      }
    });
  }
  if (jsonSchema.dependentRequired && typeof jsonSchema.dependentRequired === 'object') {
    constrained = constrained.refine((value) => {
      const record = value as Record<string, unknown>;
      return Object.entries(jsonSchema.dependentRequired ?? {}).every(([key, dependencies]) => {
        if (!(key in record)) return true;
        return dependencies.every((dependency) => dependency in record);
      });
    }, 'Dependent required validation failed');
  }
  if (jsonSchema.dependentSchemas && typeof jsonSchema.dependentSchemas === 'object') {
    const dependentSchemas = Object.entries(jsonSchema.dependentSchemas).map(
      ([key, dependency]) => ({
        key,
        schema: jsonSchemaToZodWithContext(dependency, rootSchema),
      }),
    );
    constrained = constrained.refine((value) => {
      const record = value as Record<string, unknown>;
      return dependentSchemas.every(({ key, schema }) => {
        if (!(key in record)) return true;
        return schema.safeParse(record).success;
      });
    }, 'Dependent schema validation failed');
  }
  return constrained;
}

function applyRequiredProperties(schema: z.ZodType<any>, required: string[]): z.ZodType<any> {
  if (required.length === 0) {
    return schema;
  }

  return schema.superRefine((value, ctx) => {
    const record = value as Record<string, unknown>;
    for (const key of required) {
      if (key in record) continue;
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'Required',
      });
    }
  });
}

function unionToZod(schemas: unknown[], rootSchema: unknown): z.ZodType<any> {
  if (schemas.length === 0) return z.any();
  if (schemas.length === 1) return jsonSchemaToZodWithContext(schemas[0], rootSchema);
  const [first, second, ...rest] = schemas.map((part) =>
    jsonSchemaToZodWithContext(part, rootSchema),
  );
  return z.union([first, second, ...rest]);
}

function oneOfToZod(schemas: unknown[], rootSchema: unknown): z.ZodType<any> {
  if (schemas.length === 0) return z.any();
  if (schemas.length === 1) return jsonSchemaToZodWithContext(schemas[0], rootSchema);
  const parts = schemas.map((part) => jsonSchemaToZodWithContext(part, rootSchema));
  return z.any().transform((value, ctx) => {
    const matches = parts
      .map((part) => part.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data);

    if (matches.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected exactly one oneOf schema to match',
      });
      return z.NEVER;
    }

    return matches[0];
  });
}

function unionLiterals(literals: z.ZodLiteral<any>[]): z.ZodType<any> {
  if (literals.length === 1) return literals[0];
  const [first, second, ...rest] = literals;
  return z.union([first, second, ...rest]);
}

function combineWithSiblingKeywords(
  baseSchema: z.ZodType<any>,
  siblings: Record<string, unknown>,
  rootSchema: unknown,
): z.ZodType<any> {
  if (!hasValidationKeywords(siblings)) {
    return baseSchema;
  }
  return jsonSchemaToZodWithContext(siblings, rootSchema).and(baseSchema);
}

function finalizeSchema(
  baseSchema: z.ZodType<any>,
  jsonSchema: JsonSchema,
  rootSchema: unknown,
): z.ZodType<any> {
  return applyConditionalKeywords(baseSchema, jsonSchema, rootSchema).describe(
    jsonSchema.description || '',
  );
}

function applyConditionalKeywords(
  schema: z.ZodType<any>,
  jsonSchema: JsonSchema,
  rootSchema: unknown,
): z.ZodType<any> {
  let constrained = schema;
  if (jsonSchema.not !== undefined) {
    const notSchema = jsonSchemaToZodWithContext(jsonSchema.not, rootSchema);
    constrained = constrained.refine(
      (value) => !notSchema.safeParse(value).success,
      'Negated schema validation failed',
    );
  }
  if (jsonSchema.if !== undefined) {
    const ifSchema = jsonSchemaToZodWithContext(jsonSchema.if, rootSchema);
    const thenSchema =
      jsonSchema.then !== undefined
        ? jsonSchemaToZodWithContext(jsonSchema.then, rootSchema)
        : z.any();
    const elseSchema =
      jsonSchema.else !== undefined
        ? jsonSchemaToZodWithContext(jsonSchema.else, rootSchema)
        : z.any();
    constrained = constrained.refine((value) => {
      const branchSchema = ifSchema.safeParse(value).success ? thenSchema : elseSchema;
      return branchSchema.safeParse(value).success;
    }, 'Conditional schema validation failed');
  }
  return constrained;
}

function hasValidationKeywords(schema: Record<string, unknown>): boolean {
  return Object.keys(schema).some(
    (key) =>
      !['description', '$defs', '$ref'].includes(key) &&
      schema[key as keyof typeof schema] !== undefined,
  );
}

function hasObjectKeywords(schema: JsonSchema): boolean {
  return (
    schema.properties !== undefined ||
    schema.patternProperties !== undefined ||
    schema.required !== undefined ||
    schema.dependentRequired !== undefined ||
    schema.dependentSchemas !== undefined ||
    schema.minProperties !== undefined ||
    schema.maxProperties !== undefined ||
    schema.additionalProperties !== undefined ||
    schema.propertyNames !== undefined
  );
}

function hasArrayKeywords(schema: JsonSchema): boolean {
  return (
    schema.prefixItems !== undefined ||
    schema.items !== undefined ||
    schema.contains !== undefined ||
    schema.minItems !== undefined ||
    schema.maxItems !== undefined ||
    schema.minContains !== undefined ||
    schema.maxContains !== undefined ||
    schema.uniqueItems !== undefined
  );
}

function hasStringKeywords(schema: JsonSchema): boolean {
  return (
    schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern !== undefined
  );
}

function hasNumberKeywords(schema: JsonSchema): boolean {
  return (
    schema.minimum !== undefined ||
    schema.maximum !== undefined ||
    schema.exclusiveMinimum !== undefined ||
    schema.exclusiveMaximum !== undefined ||
    schema.multipleOf !== undefined
  );
}

function resolveLocalRef(rootSchema: unknown, ref: string): unknown | undefined {
  if (ref === '#') return rootSchema;
  if (!rootSchema || typeof rootSchema !== 'object') return undefined;

  if (ref.startsWith('#/')) {
    let current: unknown = rootSchema;
    for (const token of ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
      if (!current || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[token];
    }
    return current;
  }

  if (ref.startsWith('#')) {
    const anchor = decodeURIComponent(ref.slice(1));
    if (!anchor) return undefined;
    return findAnchor(rootSchema, anchor);
  }

  return undefined;
}

function findAnchor(schema: unknown, anchor: string): unknown | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }

  const schemaObject = schema as Record<string, unknown>;
  if (schemaObject.$anchor === anchor) {
    return schema;
  }

  for (const value of Object.values(schemaObject)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findAnchor(item, anchor);
        if (found !== undefined) return found;
      }
      continue;
    }

    const found = findAnchor(value, anchor);
    if (found !== undefined) return found;
  }

  return undefined;
}

function propertyNamesToZod(jsonSchema: unknown, rootSchema: unknown): z.ZodType<string> {
  if (jsonSchema && typeof jsonSchema === 'object' && !Array.isArray(jsonSchema)) {
    const schema = jsonSchema as JsonSchema;
    return jsonSchemaToZodWithContext(
      schema.type === undefined ? { type: 'string', ...schema } : schema,
      rootSchema,
    ) as z.ZodType<string>;
  }
  return jsonSchemaToZodWithContext(jsonSchema, rootSchema) as z.ZodType<string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMultipleOf(value: number, divisor: number): boolean {
  const quotient = value / divisor;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function hasUniqueItems(items: unknown[]): boolean {
  return items.every(
    (item, index) => items.findIndex((candidate) => isDeepStrictEqual(candidate, item)) === index,
  );
}
