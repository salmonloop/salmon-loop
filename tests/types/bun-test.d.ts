type ViCompatFactory =
  | (() => unknown)
  | (() => Promise<unknown>)
  | ((importOriginal: () => Promise<unknown>) => unknown | Promise<unknown>);

type ViCompat = {
  mock(modulePath: string): unknown;
  mock(modulePath: string, factory: ViCompatFactory): unknown;
  mocked<T extends (...args: any[]) => any>(value: T): import('bun:test').Mock<T>;
  mocked<T>(value: T): T;
  hoisted<T>(factory: () => T): T;
  isMockFunction(value: unknown): boolean;
  stubEnv(key: string, value: string | undefined): void;
  unstubAllEnvs(): void;
  stubGlobal(key: string, value: unknown): void;
  unstubAllGlobals(): void;
  resetModules(): Promise<void> | void;
  importActual<T>(modulePath: string): Promise<T>;
  doMock(modulePath: string, factory?: ViCompatFactory): unknown;
  setSystemTime(when: string | number | Date): void;
  advanceTimersByTimeAsync(ms: number): Promise<void>;
  runAllTimersAsync(): Promise<void>;
};

declare module 'bun:test' {
  export type Mock<_T extends (...args: any[]) => any = (...args: any[]) => any> = any;
  export const describe: any;
  export const it: any;
  export const test: any;
  export const expect: any;
  export const beforeEach: any;
  export const afterEach: any;
  export const beforeAll: any;
  export const afterAll: any;

  interface Expect {
    fail(message?: string): never;
  }

  // Keep Bun's runtime API surface while allowing Vitest-compatible helpers added in tests/setup-bun.ts.
  export const vi: any & ViCompat;

  export const mock: {
    module(
      modulePath: string,
      factory: () => Record<string, unknown> | Promise<Record<string, unknown>>,
    ): void;
  };
}

declare const describe: any;
declare const it: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const beforeAll: any;
declare const afterAll: any;
declare const vi: any & ViCompat;
