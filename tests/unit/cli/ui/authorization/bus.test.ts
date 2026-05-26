import { describe, expect, it } from 'bun:test';

import type { UIAction } from '../../../../../src/cli/ui/store/types.js';

let busImportSeq = 0;
async function importFreshBus() {
  busImportSeq += 1;
  return import(`../../../../../src/cli/ui/authorization/bus.js?bun_bust=${busImportSeq}`);
}

describe('UI Authorization Bus', () => {
  it('returns deny when UI is unavailable (no dispatch bound)', async () => {
    const bus = await importFreshBus();
    const result = await bus.requestAuthorization({
      id: 'auth-0',
      message: 'Approve this action?',
      challenge: 'yes or no',
    });
    expect(result).toEqual({ outcome: 'deny', reason: 'UI unavailable' });
  });

  it('dispatches SET_AUTHORIZATION and resolves with the outcome', async () => {
    const bus = await importFreshBus();
    const actions: UIAction[] = [];
    bus.bindAuthorizationDispatch((action: UIAction) => actions.push(action));

    const prompt = {
      id: 'auth-1',
      message: 'Approve?',
      challenge: 'yes or no',
    };

    const p = bus.requestAuthorization(prompt);
    expect(actions[0]).toEqual({ type: 'SET_AUTHORIZATION', payload: prompt });

    bus.resolveAuthorization(prompt.id, { outcome: 'allow' });
    await expect(p).resolves.toEqual({ outcome: 'allow' });
    expect(actions.some((a) => a.type === 'CLEAR_AUTHORIZATION')).toBe(true);
  });

  it('rejectAuthorization resolves with deny and clears authorization', async () => {
    const bus = await importFreshBus();
    const actions: UIAction[] = [];
    bus.bindAuthorizationDispatch((action: UIAction) => actions.push(action));

    const p = bus.requestAuthorization({
      id: 'auth-2',
      message: 'Approve?',
      challenge: 'yes or no',
    });

    bus.rejectAuthorization();
    await expect(p).resolves.toEqual({ outcome: 'deny', reason: 'User cancelled' });
    expect(actions.some((a) => a.type === 'CLEAR_AUTHORIZATION')).toBe(true);
  });

  it('returns deny when an authorization is already pending', async () => {
    const bus = await importFreshBus();
    bus.bindAuthorizationDispatch(() => {});

    const p1 = bus.requestAuthorization({
      id: 'auth-concurrent-1',
      message: 'First request',
      challenge: 'c1',
    });

    const result2 = await bus.requestAuthorization({
      id: 'auth-concurrent-2',
      message: 'Second request',
      challenge: 'c2',
    });

    expect(result2).toEqual({ outcome: 'deny', reason: 'Authorization pending' });

    bus.rejectAuthorization(); // Resolve the first one to cleanup
    await p1;
  });

  it('ignores resolveAuthorization if the ID does not match the pending authorization', async () => {
    const bus = await importFreshBus();
    bus.bindAuthorizationDispatch(() => {});

    const p = bus.requestAuthorization({
      id: 'auth-id-match-test',
      message: 'Approve?',
      challenge: 'c',
    });

    bus.resolveAuthorization('wrong-id', { outcome: 'allow' });

    // Should still be pending
    expect(bus.getPendingAuthorization()?.id).toBe('auth-id-match-test');

    bus.resolveAuthorization('auth-id-match-test', { outcome: 'allow' });
    await expect(p).resolves.toEqual({ outcome: 'allow' });
  });

  it('does not crash when rejectAuthorization is called without a pending authorization', async () => {
    const bus = await importFreshBus();
    expect(() => bus.rejectAuthorization()).not.toThrow();
  });

  describe('getPendingAuthorization', () => {
    it('returns null initially', async () => {
      const bus = await importFreshBus();
      expect(bus.getPendingAuthorization()).toBeNull();
    });

    it('returns the prompt while authorization is pending', async () => {
      const bus = await importFreshBus();
      bus.bindAuthorizationDispatch(() => {});

      const prompt = {
        id: 'auth-3',
        message: 'Approve?',
        challenge: 'yes or no',
      };

      const p = bus.requestAuthorization(prompt);
      expect(bus.getPendingAuthorization()).toEqual(prompt);

      bus.rejectAuthorization();
      await p; // Wait for promise to resolve
    });

    it('returns null after authorization is resolved', async () => {
      const bus = await importFreshBus();
      bus.bindAuthorizationDispatch(() => {});

      const prompt = {
        id: 'auth-4',
        message: 'Approve?',
        challenge: 'yes or no',
      };

      const p = bus.requestAuthorization(prompt);
      expect(bus.getPendingAuthorization()).toEqual(prompt);

      bus.resolveAuthorization(prompt.id, { outcome: 'allow' });
      await p;

      expect(bus.getPendingAuthorization()).toBeNull();
    });
  });
});
