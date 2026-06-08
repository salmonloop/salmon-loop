import { z } from 'zod';

type ZodDefWithInner = { innerType?: unknown; out?: unknown };

/**
 * Unwrap Zod wrapper types (ZodPipe, ZodOptional, ZodNullable, ZodDefault)
 * to get the underlying schema. Useful for schema generation and hint building.
 */
export function unwrapZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 20; depth++) {
    if (current instanceof z.ZodPipe) {
      current = (current.def as ZodDefWithInner).out as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodOptional) {
      current = (current.def as ZodDefWithInner).innerType as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = (current.def as ZodDefWithInner).innerType as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = (current.def as ZodDefWithInner).innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return current;
}
