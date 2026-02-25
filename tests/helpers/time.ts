import { advanceTimersByTime, getTimerCount, runOnlyPendingTimers } from './bun-timers.ts';

export function freezeSystemTime(when: string | number | Date): () => void {
  const originalDate = Date;
  const frozenMs = new Date(when).getTime();
  type DateArgs =
    | []
    | [value: string | number | Date]
    | [
        year: number,
        monthIndex: number,
        date?: number,
        hours?: number,
        minutes?: number,
        seconds?: number,
        ms?: number,
      ];

  class FrozenDate extends Date {
    constructor(...args: DateArgs) {
      if (args.length === 0) {
        super(frozenMs);
        return;
      }
      if (args.length === 1) {
        super(args[0]);
        return;
      }
      super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    }

    static now() {
      return frozenMs;
    }
  }

  globalThis.Date = FrozenDate as DateConstructor;
  return () => {
    globalThis.Date = originalDate;
  };
}

export async function advanceFakeTimers(ms: number): Promise<void> {
  let remaining = Math.max(0, Math.floor(ms));
  while (remaining > 0) {
    const chunk = remaining >= 10_000 ? 250 : remaining >= 2_000 ? 50 : remaining >= 200 ? 10 : 1;
    const step = Math.min(remaining, chunk);
    advanceTimersByTime(step);
    remaining -= step;
    await Promise.resolve();
  }

  if (typeof getTimerCount === 'function' && typeof runOnlyPendingTimers === 'function') {
    for (let i = 0; i < 20; i += 1) {
      const before = getTimerCount();
      if (!Number.isFinite(before) || before <= 0) break;
      runOnlyPendingTimers();
      await Promise.resolve();
      const after = getTimerCount();
      if (!Number.isFinite(after) || after <= 0 || after === before) break;
    }
  }
}
