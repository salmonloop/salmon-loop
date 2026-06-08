import { z } from 'zod';

/**
 * Unwrap Zod wrapper types (ZodEffects, ZodPipe, ZodOptional, ZodNullable, ZodDefault)
 * to get the underlying schema. Useful for schema generation and hint building.
 */
export function unwrapZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 20; depth++) {
    const ZodEffects: any = (z as any).ZodEffects;
    if (typeof ZodEffects === 'function' && current instanceof ZodEffects) {
      current = (current as any)._def.schema;
      continue;
    }
    if (current instanceof z.ZodPipe) {
      current = (current as any)._def.out;
      continue;
    }
    if (current instanceof z.ZodOptional) {
      current = (current as any)._def.innerType;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = (current as any)._def.innerType;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = (current as any)._def.innerType;
      continue;
    }
    break;
  }
  return current;
}
