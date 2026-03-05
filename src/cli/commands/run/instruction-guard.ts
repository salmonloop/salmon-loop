import { randomUUID } from 'crypto';

import type { Command } from 'commander';

import { getLogger } from '../../../core/facades/cli-observability.js';
import { text } from '../../locales/index.js';

export function ensureInstructionOrExit(params: {
  command: Command;
  instruction?: string;
  validate: boolean;
  outputFormat: 'text' | 'json' | 'stream-json';
  sessionIdForOutput?: string;
  writeJsonFailure: (args: { message: string; repoPath?: string }) => void;
  repoPath: string;
  headlessErrorWriter: {
    writeUnexpectedError: (args: { sessionId?: string; message: string }) => void;
  };
}): { ok: true } | { ok: false; exitCode: 1 } {
  if (params.instruction) return { ok: true };
  if (params.validate) return { ok: true };

  getLogger().error(text.cli.optionsRequired);

  if (params.outputFormat === 'text') {
    params.command.help();
    return { ok: false, exitCode: 1 };
  }

  if (params.outputFormat === 'json') {
    params.writeJsonFailure({ message: text.cli.optionsRequired, repoPath: params.repoPath });
    return { ok: false, exitCode: 1 };
  }

  params.headlessErrorWriter.writeUnexpectedError({
    sessionId: params.sessionIdForOutput ?? randomUUID(),
    message: text.cli.optionsRequired,
  });
  return { ok: false, exitCode: 1 };
}
