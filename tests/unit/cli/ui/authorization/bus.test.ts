import { describe, expect, it } from 'bun:test';

type AuthorizationBusModule = typeof import('../../../../../src/cli/ui/authorization/bus.js');

let busImportSeq = 0;
async function importFreshBus(): Promise<AuthorizationBusModule> {
  busImportSeq += 1;
  return import(
    `../../../../../src/cli/ui/authorization/bus.js?bun_bust=${busImportSeq}`
  ) as Promise<AuthorizationBusModule>;
}

describe('UI Authorization Bus', () => {
  it('returns null when UI is unavailable (no dispatch bound)', async () => {
    const mod = await importFreshBus();
    const result = await mod.requestAuthorization({
      id: 'auth-0',
      message: 'Approve this action?',
      challenge: 'yes or no',
    });
    expect(result).toEqual({ outcome: 'deny', reason: 'UI unavailable' });
  });

  it('dispatches SET_AUTHORIZATION and resolves with the outcome', async () => {
    const mod = await importFreshBus();

    const actions: any[] = [];
    mod.bindAuthorizationDispatch((action: any) => actions.push(action));

    const prompt = {
      id: 'auth-1',
      message: 'Approve?',
      challenge: 'yes or no',
    };

    const p = mod.requestAuthorization(prompt);
    expect(actions[0]).toEqual({ type: 'SET_AUTHORIZATION', payload: prompt });

    mod.resolveAuthorization(prompt.id, { outcome: 'allow' });
    await expect(p).resolves.toEqual({ outcome: 'allow' });
    expect(actions.some((a) => a.type === 'CLEAR_AUTHORIZATION')).toBe(true);
  });

  it('rejectAuthorization resolves with deny and clears authorization', async () => {
    const mod = await importFreshBus();

    const actions: any[] = [];
    mod.bindAuthorizationDispatch((action: any) => actions.push(action));

    const p = mod.requestAuthorization({
      id: 'auth-2',
      message: 'Approve?',
      challenge: 'yes or no',
    });

    mod.rejectAuthorization();
    await expect(p).resolves.toEqual({ outcome: 'deny', reason: 'User cancelled' });
    expect(actions.some((a) => a.type === 'CLEAR_AUTHORIZATION')).toBe(true);
  });

  describe('getPendingAuthorization', () => {
    it('returns null initially', async () => {
      const mod = await importFreshBus();
      expect(mod.getPendingAuthorization()).toBeNull();
    });

    it('returns the prompt while authorization is pending', async () => {
      const mod = await importFreshBus();
      mod.bindAuthorizationDispatch(() => {});

      const prompt = {
        id: 'auth-3',
        message: 'Approve?',
        challenge: 'yes or no',
      };

      const p = mod.requestAuthorization(prompt);
      expect(mod.getPendingAuthorization()).toEqual(prompt);

      mod.rejectAuthorization();
      await p; // Wait for promise to resolve
    });

    it('returns null after authorization is resolved', async () => {
      const mod = await importFreshBus();
      mod.bindAuthorizationDispatch(() => {});

      const prompt = {
        id: 'auth-4',
        message: 'Approve?',
        challenge: 'yes or no',
      };

      const p = mod.requestAuthorization(prompt);
      expect(mod.getPendingAuthorization()).toEqual(prompt);

      mod.resolveAuthorization(prompt.id, { outcome: 'allow' });
      await p;

      expect(mod.getPendingAuthorization()).toBeNull();
    });
  });
});
