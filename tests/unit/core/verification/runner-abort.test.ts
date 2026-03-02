import { describe, expect, test } from 'bun:test';

import { runVerify } from '../../../../src/core/verification/runner.js';

describe('verification runner', () => {
  test(
    'aborts verification command when signal is aborted',
    async () => {
      const controller = new AbortController();
      const command = `${process.execPath} -e "setTimeout(()=>{}, 20000)"`;

      const verifyPromise = runVerify(process.cwd(), command, undefined, controller.signal);

      await new Promise((r) => setTimeout(r, 50));
      controller.abort();

      const result = await verifyPromise;
      expect(result.ok).toBe(false);
      expect(result.exitCode).not.toBe(0);
    },
    { timeout: 2000 },
  );
});
