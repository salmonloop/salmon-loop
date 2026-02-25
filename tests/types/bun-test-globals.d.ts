/// <reference types="bun-types/test-globals" />

declare let mock: typeof import('bun:test').mock;
declare let spyOn: typeof import('bun:test').spyOn;
declare let setSystemTime: typeof import('bun:test').setSystemTime;
declare let useFakeTimers: typeof import('bun:test').jest.useFakeTimers;
declare let useRealTimers: typeof import('bun:test').jest.useRealTimers;
declare let advanceTimersByTime: typeof import('bun:test').jest.advanceTimersByTime;
declare let advanceTimersToNextTimer: typeof import('bun:test').jest.advanceTimersToNextTimer;
declare let runAllTimers: typeof import('bun:test').jest.runAllTimers;
declare let runOnlyPendingTimers: typeof import('bun:test').jest.runOnlyPendingTimers;
declare let clearAllTimers: typeof import('bun:test').jest.clearAllTimers;
