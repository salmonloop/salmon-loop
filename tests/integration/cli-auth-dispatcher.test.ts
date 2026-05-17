import { describe, it, expect, afterEach } from 'bun:test';

import { CommandDispatcher } from '../../src/cli/commands/dispatcher.js';
import { text } from '../../src/cli/locales/index.js';
import type { ToolAuthorizationConfig } from '../../src/core/config/types.js';
import type { ChatSessionManager } from '../../src/core/session/manager.js';
import type { LoopEvent } from '../../src/core/types/index.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

const helper = new RealFsTestHelper();

describe('CLI /allowlist dispatcher integration', () => {
  afterEach(async () => {
    await helper.cleanup();
  });

  it('adds, lists, and removes allowlist entries via /allowlist', async () => {
    const repoPath = await helper.createTempDir('auth-dispatch-');
    const dispatcher = new CommandDispatcher();
    const emit = mock();

    const sessionManager = {
      getCurrent: () => ({ meta: { repoPath } }),
      addMessage: mock(),
      addIteration: mock(),
      save: mock(),
    } as unknown as ChatSessionManager;

    const toolAuthorization: ToolAuthorizationConfig = {
      sessionTtlMs: 1000,
      autoAllowRisk: { low: true, medium: false, high: false },
      allowlist: {
        repoFile: '.salmonloop/config/authorization.json',
        userFile: '.salmonloop/config/authorization-user.json',
      },
    };

    const getLastLogMessage = () => {
      const events = emit.mock.calls
        .map((call: unknown[]) => call[0] as LoopEvent)
        .filter((event): event is Extract<LoopEvent, { type: 'log' }> => event.type === 'log');
      return events.at(-1)?.message ?? '';
    };

    const addResult = await dispatcher.dispatch('/allowlist add repo fs.read context', {
      emit,
      sessionManager,
      dispatch: mock(),
      toolAuthorization,
    });

    expect(addResult).toEqual({ type: 'executed' });
    expect(await helper.fileExists(repoPath, '.salmonloop/config/authorization.json')).toBe(true);

    const allowlistRaw = (await helper.readFile(
      repoPath,
      '.salmonloop/config/authorization.json',
      'utf-8',
    )) as string;
    const allowlist = JSON.parse(allowlistRaw);
    expect(allowlist.version).toBe(1);
    expect(allowlist.tools?.['fs.read']?.rules?.length).toBe(1);
    expect(allowlist.tools?.['fs.read']?.rules?.[0]?.phase).toBe('CONTEXT');

    const listResult = await dispatcher.dispatch('/allowlist list repo', {
      emit,
      sessionManager,
      dispatch: mock(),
      toolAuthorization,
    });

    expect(listResult).toEqual({ type: 'executed' });
    const listMessage = getLastLogMessage();
    expect(listMessage).toContain('fs.read');
    expect(listMessage).toContain('mode=allow');

    const removeResult = await dispatcher.dispatch('/allowlist remove repo fs.read context', {
      emit,
      sessionManager,
      dispatch: mock(),
      toolAuthorization,
    });

    expect(removeResult).toEqual({ type: 'executed' });
    expect(getLastLogMessage()).toBe(text.cli.authRemoved('fs.read', 'repo'));

    const listEmptyResult = await dispatcher.dispatch('/allowlist list repo', {
      emit,
      sessionManager,
      dispatch: mock(),
      toolAuthorization,
    });

    expect(listEmptyResult).toEqual({ type: 'executed' });
    expect(getLastLogMessage()).toBe(text.cli.authListEmpty('repo'));
  });
});
