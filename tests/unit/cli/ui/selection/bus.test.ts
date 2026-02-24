import { describe, expect, it } from 'bun:test';

type SelectionBusModule = typeof import('../../../../../src/cli/ui/selection/bus.js');

let busImportSeq = 0;
async function importFreshBus(): Promise<SelectionBusModule> {
  busImportSeq += 1;
  return import(
    `../../../../../src/cli/ui/selection/bus.js?bun_bust=${busImportSeq}`
  ) as Promise<SelectionBusModule>;
}

describe('UI Selection Bus', () => {
  it('returns null when UI is unavailable', async () => {
    const mod = await importFreshBus();
    const result = await mod.requestSelection({
      id: 'sel-0',
      title: 'Pick one',
      items: [{ id: 'a', label: 'A' }],
    });
    expect(result).toBeNull();
  });

  it('dispatches SET_SELECTION and resolves with the selected item', async () => {
    const mod = await importFreshBus();

    const actions: any[] = [];
    mod.bindSelectionDispatch((action: any) => actions.push(action));

    const prompt = {
      id: 'sel-1',
      title: 'Pick one',
      items: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', description: 'Second' },
      ],
    };

    const p = mod.requestSelection(prompt);
    expect(actions[0]).toEqual({ type: 'SET_SELECTION', payload: prompt });

    mod.resolveSelection(prompt.id, 'b');
    await expect(p).resolves.toBe('b');
    expect(actions.some((a) => a.type === 'CLEAR_SELECTION')).toBe(true);
  });

  it('rejectSelection resolves with null and clears selection', async () => {
    const mod = await importFreshBus();

    const actions: any[] = [];
    mod.bindSelectionDispatch((action: any) => actions.push(action));

    const p = mod.requestSelection({
      id: 'sel-2',
      title: 'Pick one',
      items: [{ id: 'a', label: 'A' }],
    });

    mod.rejectSelection();
    await expect(p).resolves.toBeNull();
    expect(actions.some((a) => a.type === 'CLEAR_SELECTION')).toBe(true);
  });
});
