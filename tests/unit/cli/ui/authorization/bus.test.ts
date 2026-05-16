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
  it('returns deny when UI is unavailable', async () => {
    const mod = await importFreshBus();
    const result = await mod.requestAuthorization({
      id: 'auth-0',
      message: 'Approve action?',
      challenge: 'Some challenge',
    });
    expect(result).toEqual({ outcome: 'deny', reason: 'UI unavailable' });
  });

  it('dispatches SET_AUTHORIZATION and resolves with the decision', async () => {
    const mod = await importFreshBus();

    const actions: any[] = [];
    mod.bindAuthorizationDispatch((action: any) => actions.push(action));

    const prompt = {
      id: 'auth-1',
      message: 'Approve another action?',
      challenge: 'Challenge 2',
    };

    const p = mod.requestAuthorization(prompt);
    expect(actions[0]).toEqual({ type: 'SET_AUTHORIZATION', payload: prompt });

    mod.resolveAuthorization(prompt.id, { outcome: 'allow' });
    await expect(p).resolves.toEqual({ outcome: 'allow' });
    expect(actions.some((a) => a.type === 'CLEAR_AUTHORIZATION')).toBe(true);
  });

  it('rejectAuthorization resolves with deny and User cancelled reason', async () => {
    const mod = await importFreshBus();

    const actions: any[] = [];
    mod.bindAuthorizationDispatch((action: any) => actions.push(action));

    const p = mod.requestAuthorization({
      id: 'auth-2',
      message: 'Reject this action?',
      challenge: 'Challenge 3',
    });

    mod.rejectAuthorization();
    await expect(p).resolves.toEqual({ outcome: 'deny', reason: 'User cancelled' });
    expect(actions.some((a) => a.type === 'CLEAR_AUTHORIZATION')).toBe(true);
  });
});
