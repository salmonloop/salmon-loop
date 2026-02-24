declare module 'bun:test' {
  export {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    test,
    vi,
  } from 'vitest';

  // Bun runtime exposes mock.module at runtime, but the type is missing in some versions.
  export const mock: {
    module(
      modulePath: string,
      factory: () => Record<string, unknown> | Promise<Record<string, unknown>>,
    ): void;
  };
}
