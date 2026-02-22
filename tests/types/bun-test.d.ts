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

  export const mock: {
    module(
      modulePath: string,
      factory: () => Record<string, unknown> | Promise<Record<string, unknown>>,
    ): void;
  };
}
