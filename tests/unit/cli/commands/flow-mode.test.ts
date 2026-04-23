import { describe, expect, it, mock } from 'bun:test';

import { text } from '../../../../src/cli/locales/index.js';
import { FLOW_MODES } from '../../../../src/core/types/flow-mode.js';

function createContext(input: string, sessionManagerOverrides: Record<string, unknown> = {}) {
  const emit = mock();
  const sessionManager = {
    getChatFlowMode: mock(() => undefined),
    updateChatFlowMode: mock(() => {}),
    save: mock(async () => {}),
    ...sessionManagerOverrides,
  };

  return {
    emit,
    sessionManager,
    input,
    dispatch: mock(),
  };
}

describe('/flow-mode command', () => {
  it('suggests the full flow-mode set', async () => {
    const { flowModeCommand } = await import('../../../../src/cli/commands/flow-mode.js');
    const context = createContext('/flow-mode ');

    const suggestions = await flowModeCommand.getSuggestions?.(context as any);

    expect(suggestions?.map((item) => item.name)).toEqual([...FLOW_MODES]);
    expect(suggestions?.map((item) => item.description)).toEqual(
      FLOW_MODES.map((mode) => text.cli.flowModeSuggestion(mode)),
    );
  });

  it('shows autopilot as the current effective mode when the session mode is unset', async () => {
    const { flowModeCommand } = await import('../../../../src/cli/commands/flow-mode.js');
    const context = createContext('/flow-mode');

    await flowModeCommand.execute(context as any);

    expect(context.sessionManager.getChatFlowMode).toHaveBeenCalledTimes(1);
    expect(context.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'info',
        message: text.cli.flowModeCurrent('autopilot'),
      }),
    );
  });

  it('updates the current session flow mode and saves immediately', async () => {
    const { flowModeCommand } = await import('../../../../src/cli/commands/flow-mode.js');
    const context = createContext('/flow-mode review');

    await flowModeCommand.execute(context as any);

    expect(context.sessionManager.updateChatFlowMode).toHaveBeenCalledWith('review');
    expect(context.sessionManager.save).toHaveBeenCalledTimes(1);
    expect(context.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'info',
        message: text.cli.flowModeUpdated('review'),
      }),
    );
  });

  it('emits usage for invalid values and does not mutate session state', async () => {
    const { flowModeCommand } = await import('../../../../src/cli/commands/flow-mode.js');
    const context = createContext('/flow-mode invalid-mode');

    await flowModeCommand.execute(context as any);

    expect(context.sessionManager.updateChatFlowMode).not.toHaveBeenCalled();
    expect(context.sessionManager.save).not.toHaveBeenCalled();
    expect(context.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'error',
        message: text.cli.flowModeInvalid('invalid-mode'),
      }),
    );
    expect(context.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'log',
        level: 'info',
        message: text.cli.flowModeUsage,
      }),
    );
  });
});
