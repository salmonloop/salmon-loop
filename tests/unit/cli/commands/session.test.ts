const hoisted = (() => {
  const init = mock(async () => {});
  const load = mock(async () => ['hello', 'world']);
  const InputHistoryManagerMock = mock(() => ({ init, load }));
  return { init, load, InputHistoryManagerMock };
})();

mock.module('../../../../src/core/history/input-history.js', () => ({
  InputHistoryManager: hoisted.InputHistoryManagerMock,
}));

describe('/session command', () => {
  beforeEach(() => {
    hoisted.init.mockClear();
    hoisted.load.mockClear();
    hoisted.InputHistoryManagerMock.mockClear();
  });

  it('loads input history for the resumed session and updates UI store', async () => {
    const { sessionCommand } = await import('../../../../src/cli/commands/session.js');
    const dispatch = mock();
    const emit = mock();

    const sessionManager = {
      resumeSession: mock(async () => {}),
      getCurrent: mock(() => ({ meta: { id: 'full-session-id', repoPath: '/repo' } })),
      getMessages: mock(() => [
        { role: 'user', content: 'hello', timestamp: 1 },
        { role: 'assistant', content: 'world', timestamp: 2 },
      ]),
      listSessions: mock(async () => []),
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

    expect(dispatch).toHaveBeenCalledWith({
      type: 'HYDRATE_TRANSCRIPT',
      payload: [
        {
          id: 'transcript-user-1-0',
          type: 'user',
          content: 'hello',
          timestamp: new Date(1),
        },
        {
          id: 'transcript-assistant-2-1',
          type: 'assistant',
          content: 'world',
          timestamp: new Date(2),
        },
      ],
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_INPUT', payload: '' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_INPUT_HISTORY',
      payload: ['hello', 'world'],
    });
  });
});
