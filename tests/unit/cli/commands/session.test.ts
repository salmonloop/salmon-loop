import { vi } from 'vitest';

import { sessionCommand } from '../../../../src/cli/commands/session.js';

const hoisted = vi.hoisted(() => {
  const init = vi.fn(async () => {});
  const load = vi.fn(async () => ['hello', 'world']);
  const InputHistoryManagerMock = vi.fn(() => ({ init, load }));
  return { init, load, InputHistoryManagerMock };
});

vi.mock('../../../../src/core/history/input-history.js', () => ({
  InputHistoryManager: hoisted.InputHistoryManagerMock,
}));

describe('/session command', () => {
  beforeEach(() => {
    hoisted.init.mockClear();
    hoisted.load.mockClear();
    hoisted.InputHistoryManagerMock.mockClear();
  });

  it('loads input history for the resumed session and updates UI store', async () => {
    const dispatch = vi.fn();
    const emit = vi.fn();

    const sessionManager = {
      resumeSession: vi.fn(async () => {}),
      getCurrent: vi.fn(() => ({ meta: { id: 'full-session-id', repoPath: '/repo' } })),
      listSessions: vi.fn(async () => []),
    };

    await sessionCommand.execute({
      emit,
      sessionManager,
      input: '/session abcd1234',
      dispatch,
    } as any);

    expect(sessionManager.resumeSession).toHaveBeenCalledWith('abcd1234');
    expect(hoisted.InputHistoryManagerMock).toHaveBeenCalledWith('/repo');
    expect(hoisted.init).toHaveBeenCalledTimes(1);
    expect(hoisted.load).toHaveBeenCalledWith('full-session-id');

    expect(dispatch).toHaveBeenCalledWith({ type: 'RESET_MESSAGES' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_INPUT', payload: '' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_INPUT_HISTORY',
      payload: ['hello', 'world'],
    });
  });
});
