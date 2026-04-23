import { afterEach, describe, expect, it } from 'bun:test';

import { createAcpSessionStore } from '../../../src/core/protocols/acp/handlers.js';

const RealDate = Date;

function installFixedDate(iso: string) {
  const fixedTime = RealDate.parse(iso);

  class FixedDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(fixedTime);
        return;
      }
      super(...(args as ConstructorParameters<typeof Date>));
    }

    static now() {
      return fixedTime;
    }
  }

  globalThis.Date = FixedDate as DateConstructor;
}

afterEach(() => {
  globalThis.Date = RealDate;
});

describe('ACP session store', () => {
  it('keeps updatedAt strictly increasing when multiple updates happen in the same millisecond', () => {
    installFixedDate('2026-04-23T00:00:00.000Z');

    const store = createAcpSessionStore();
    const session = store.create({ cwd: '/repo', mcpServers: [] });

    const firstUpdate = store.update(session.id, (current) => ({ ...current }))!;
    const secondUpdate = store.update(session.id, (current) => ({ ...current }))!;

    expect(firstUpdate.updatedAt).toBe('2026-04-23T00:00:00.001Z');
    expect(secondUpdate.updatedAt).toBe('2026-04-23T00:00:00.002Z');
    expect(secondUpdate.updatedAt > firstUpdate.updatedAt).toBe(true);
  });
});
