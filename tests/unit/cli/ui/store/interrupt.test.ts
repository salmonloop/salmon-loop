import { initialState, uiReducer } from '../../../../../src/cli/ui/store/reducer.js';

describe('uiReducer interrupt lifecycle', () => {
  it('stores pending interrupt and pauses streaming without final splat message', () => {
    const stateWithStream = {
      ...initialState,
      activeStreamingMessage: {
        id: 's1',
        type: 'assistant',
        content: 'partial',
        timestamp: new Date('2026-02-11T18:00:00.000Z'),
        streamState: 'streaming',
      },
    } as any;

    const next = uiReducer(stateWithStream, {
      type: 'INTERRUPT_STREAM',
      payload: {
        content: 'Operation cancelled by user',
        timestamp: new Date('2026-02-11T18:01:00.000Z'),
      },
    } as any);

    expect(next.activeStreamingMessage).toBeNull();
    expect(next.interruptPending?.content).toBe('Operation cancelled by user');
    expect(next.completedMessages.some((m: any) => m.type === 'interrupt')).toBe(false);
    expect(next.completedMessages.some((m: any) => m.id === 's1')).toBe(true);
  });

  it('finalizes interrupt as a message and clears pending', () => {
    const interruptedState = {
      ...initialState,
      interruptPending: {
        content: 'Operation cancelled by user',
        timestamp: new Date('2026-02-11T18:01:00.000Z'),
      },
    } as any;

    const next = uiReducer(interruptedState, { type: 'FINALIZE_INTERRUPT' } as any);

    expect(next.interruptPending).toBeUndefined();
    expect(next.completedMessages.some((m: any) => m.type === 'interrupt')).toBe(true);
  });
});
