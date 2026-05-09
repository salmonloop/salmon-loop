import { describe, expect, it, mock } from 'bun:test';

import {
  getCommanderErrorExitCode,
  isCommanderError,
  shouldExitCommanderError,
  emitHeadlessCommanderUsageError,
} from '../../../src/cli/commander-error-adapter.js';

mock.module('../../../src/cli/headless/stdout-writer.js', () => ({
  createStdoutWriter: mock(() => ({})),
}));

mock.module('../../../src/cli/commands/run/headless-error-writer.js', () => ({
  createHeadlessErrorWriter: mock(() => ({
    writeUsageError: mock(),
  })),
}));

const { createStdoutWriter } = await import('../../../src/cli/headless/stdout-writer.js');
const { createHeadlessErrorWriter } =
  await import('../../../src/cli/commands/run/headless-error-writer.js');

describe('commander-error-adapter', () => {
  describe('isCommanderError', () => {
    it('returns true for an error with name "CommanderError"', () => {
      const err = new Error('Some error');
      err.name = 'CommanderError';
      expect(isCommanderError(err)).toBe(true);
    });

    it('returns false for standard errors', () => {
      const err = new Error('Some error');
      expect(isCommanderError(err)).toBe(false);
    });

    it('returns false for non-errors', () => {
      expect(isCommanderError('Some error')).toBe(false);
      expect(isCommanderError(123)).toBe(false);
      expect(isCommanderError(null)).toBe(false);
      expect(isCommanderError(undefined)).toBe(false);
      expect(isCommanderError({ name: 'CommanderError' })).toBe(false);
    });
  });

  describe('shouldExitCommanderError', () => {
    it('returns false when error code is commander.helpDisplayed', () => {
      const err = new Error('Help');
      (err as any).code = 'commander.helpDisplayed';
      expect(shouldExitCommanderError(err)).toBe(false);
    });

    it('returns false when error code is commander.version', () => {
      const err = new Error('Version');
      (err as any).code = 'commander.version';
      expect(shouldExitCommanderError(err)).toBe(false);
    });

    it('returns true for other error codes', () => {
      const err = new Error('Other error');
      (err as any).code = 'commander.unknownOption';
      expect(shouldExitCommanderError(err)).toBe(true);
    });

    it('returns true for errors without a code', () => {
      const err = new Error('No code');
      expect(shouldExitCommanderError(err)).toBe(true);
    });

    it('returns true for non-errors', () => {
      expect(shouldExitCommanderError('string')).toBe(true);
    });
  });

  describe('getCommanderErrorExitCode', () => {
    it('returns the exitCode property if it exists', () => {
      const err = new Error('Exit code error');
      (err as any).exitCode = 42;
      expect(getCommanderErrorExitCode(err)).toBe(42);
    });

    it('returns 1 if the exitCode property is missing', () => {
      const err = new Error('No exit code error');
      expect(getCommanderErrorExitCode(err)).toBe(1);
    });

    it('returns 1 for non-errors', () => {
      expect(getCommanderErrorExitCode('string')).toBe(1);
      expect(getCommanderErrorExitCode({ code: 'abc' })).toBe(1);
    });
  });

  describe('emitHeadlessCommanderUsageError', () => {
    it('returns early if outputFormat is missing', () => {
      const headlessDetection: any = {};
      const err = new Error('Some error');
      emitHeadlessCommanderUsageError({ err, headlessDetection });
      expect(createHeadlessErrorWriter).not.toHaveBeenCalled();
    });

    it('returns early if error is commander.helpDisplayed', () => {
      const headlessDetection: any = { outputFormat: 'json' };
      const err = new Error('Help');
      (err as any).code = 'commander.helpDisplayed';
      emitHeadlessCommanderUsageError({ err, headlessDetection });
      expect(createHeadlessErrorWriter).not.toHaveBeenCalled();
    });

    it('returns early if error is commander.version', () => {
      const headlessDetection: any = { outputFormat: 'json' };
      const err = new Error('Version');
      (err as any).code = 'commander.version';
      emitHeadlessCommanderUsageError({ err, headlessDetection });
      expect(createHeadlessErrorWriter).not.toHaveBeenCalled();
    });

    it('calls writeUsageError with correct parameters for a standard error', () => {
      const writeUsageErrorMock = mock();
      (createHeadlessErrorWriter as ReturnType<typeof mock>).mockReturnValue({
        writeUsageError: writeUsageErrorMock,
      });

      const headlessDetection: any = {
        outputFormat: 'json',
        instruction: 'Do something',
        repoPath: '/mock/path',
        outputProfile: 'legacy',
        resumeSessionId: 'session-123',
      };
      const err = new Error('Custom usage error');
      (err as any).code = 'commander.unknownOption';

      emitHeadlessCommanderUsageError({ err, headlessDetection });

      expect(createStdoutWriter).toHaveBeenCalled();
      expect(createHeadlessErrorWriter).toHaveBeenCalledWith({
        repoPath: '/mock/path',
        outputFormat: 'json',
        outputProfileForStreamJson: 'legacy',
        writer: expect.anything(),
        getSessionId: expect.any(Function),
        getResumeSessionId: expect.any(Function),
      });

      // Verify the returned resumeSessionId matches
      const writerArgs = (createHeadlessErrorWriter as ReturnType<typeof mock>).mock.calls[0][0];
      expect(writerArgs.getResumeSessionId()).toBe('session-123');
      expect(writerArgs.getSessionId()).toBeUndefined();

      expect(writeUsageErrorMock).toHaveBeenCalledWith({
        message: 'Custom usage error',
        instruction: 'Do something',
      });
    });

    it('uses default values when optional fields are missing in headlessDetection', () => {
      const writeUsageErrorMock = mock();
      (createHeadlessErrorWriter as ReturnType<typeof mock>).mockReturnValue({
        writeUsageError: writeUsageErrorMock,
      });

      const headlessDetection: any = {
        outputFormat: 'json',
        instruction: 'Fallback instruction',
      };
      const err = 'String error message';

      emitHeadlessCommanderUsageError({ err, headlessDetection });

      expect(createHeadlessErrorWriter).toHaveBeenCalledWith({
        repoPath: process.cwd(),
        outputFormat: 'json',
        outputProfileForStreamJson: 'native',
        writer: expect.anything(),
        getSessionId: expect.any(Function),
        getResumeSessionId: expect.any(Function),
      });

      expect(writeUsageErrorMock).toHaveBeenCalledWith({
        message: 'String error message',
        instruction: 'Fallback instruction',
      });
    });
  });
});
