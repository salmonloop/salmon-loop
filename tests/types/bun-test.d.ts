declare module 'bun:test' {
  export const describe: any;
  export const it: any;
  export const test: any;
  export const expect: any;
  export const beforeEach: any;
  export const afterEach: any;
  export const beforeAll: any;
  export const afterAll: any;
  export const vi: any;
  export const mock: {
    module(
      modulePath: string,
      factory: () => Record<string, unknown> | Promise<Record<string, unknown>>,
    ): void;
    restore(): void;
  };
}

declare const describe: typeof import('bun:test').describe;
declare const it: typeof import('bun:test').it;
declare const test: typeof import('bun:test').test;
declare const expect: typeof import('bun:test').expect;
declare const beforeEach: typeof import('bun:test').beforeEach;
declare const afterEach: typeof import('bun:test').afterEach;
declare const beforeAll: typeof import('bun:test').beforeAll;
declare const afterAll: typeof import('bun:test').afterAll;
declare const vi: typeof import('bun:test').vi;
declare const mock: typeof import('bun:test').mock;
