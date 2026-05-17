import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { handleEarlyRunCommandErrors } from '../../../../../src/cli/commands/run/early-errors.js';
import { clearLogger, setLogger } from '../../../../../src/core/observability/logger.js';

const logger = {
  error: mock(() => {}),
};

function makeWriter() {
  return {
    writeUsageError: mock(() => {}),
    writeJsonFailure: mock(() => {}),
    writeUnexpectedError: mock(() => {}),
  };
}

function baseParams(
  overrides: Partial<Parameters<typeof handleEarlyRunCommandErrors>[0]> = {},
): Parameters<typeof handleEarlyRunCommandErrors>[0] {
  return {
    headlessOutput: true,
    outputFormat: 'json',
    outputProfileForStreamJson: 'native',
    headlessIncludeToolInput: false,
    headlessIncludeToolOutput: false,
    headlessIncludeAuthorizationDecisions: false,
    instruction: 'fix it',
    continueSession: false,
    headlessErrorWriter: makeWriter(),
    ...overrides,
  };
}

describe('run command early errors', () => {
  afterAll(() => {
    clearLogger();
  });

  beforeEach(() => {
    mock.clearAllMocks();
    setLogger(logger as any);
  });

  it('requires a SWE-bench instance id when writing predictions', () => {
    const writer = makeWriter();

    const result = handleEarlyRunCommandErrors(
      baseParams({
        headlessErrorWriter: writer,
        sweBenchModelName: 'salmon-loop',
        sweBenchPredictionsPath: '/tmp/predictions.jsonl',
      }),
    );

    expect(result).toEqual({ ok: false, exitCode: 1 });
    expect(writer.writeUsageError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '--swe-bench-predictions requires --swe-bench-instance-id.',
      }),
    );
  });

  it('requires a SWE-bench model name when writing predictions', () => {
    const writer = makeWriter();

    const result = handleEarlyRunCommandErrors(
      baseParams({
        headlessErrorWriter: writer,
        sweBenchInstanceId: 'repo__issue-1',
        sweBenchPredictionsPath: '/tmp/predictions.jsonl',
      }),
    );

    expect(result).toEqual({ ok: false, exitCode: 1 });
    expect(writer.writeUsageError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '--swe-bench-predictions requires --swe-bench-model-name.',
      }),
    );
  });
});
