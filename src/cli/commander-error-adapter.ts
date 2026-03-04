import type { DetectedHeadlessOutput } from './argv/headless-detection.js';
import { getCommanderCode, getCommanderExitCode } from './commander-error-meta.js';
import { createHeadlessErrorWriter } from './commands/run/headless-error-writer.js';
import { createStdoutWriter } from './headless/stdout-writer.js';

function isCommanderHelpLike(code: string | undefined): boolean {
  return code === 'commander.helpDisplayed' || code === 'commander.version';
}

export function isCommanderError(err: unknown): boolean {
  return (err instanceof Error ? err.name : undefined) === 'CommanderError';
}

export function shouldExitCommanderError(err: unknown): boolean {
  return !isCommanderHelpLike(getCommanderCode(err));
}

export function getCommanderErrorExitCode(err: unknown): number {
  return getCommanderExitCode(err) || 1;
}

export function emitHeadlessCommanderUsageError(params: {
  err: unknown;
  headlessDetection: DetectedHeadlessOutput;
}): void {
  if (!params.headlessDetection.outputFormat) return;
  if (isCommanderHelpLike(getCommanderCode(params.err))) return;

  const writer = createStdoutWriter();
  const headlessErrorWriter = createHeadlessErrorWriter({
    repoPath: params.headlessDetection.repoPath ?? process.cwd(),
    outputFormat: params.headlessDetection.outputFormat,
    outputProfileForStreamJson: params.headlessDetection.outputProfile ?? 'native',
    writer,
    getSessionId: () => undefined,
    getResumeSessionId: () => params.headlessDetection.resumeSessionId,
  });
  headlessErrorWriter.writeUsageError({
    message: params.err instanceof Error ? params.err.message : String(params.err),
    instruction: params.headlessDetection.instruction,
  });
}
