import { logger } from '../../../core/observability/logger.js';
import { text } from '../../locales/index.js';

export function handleEarlyRunCommandErrors(params: {
  headlessOutput: boolean;
  outputFormat: 'text' | 'json' | 'stream-json';
  rawOutputProfile?: string;
  outputProfileForStreamJson: string;
  instruction?: string;
  printInstruction?: string;
  explicitInstruction?: string;
  continueSession: boolean;
  resumeSessionId?: string;
  jsonSchemaSpec?: string;
  sessionIdForOutput?: string;
  headlessErrorWriter: {
    writeUsageError: (args: {
      message: string;
      instruction?: string;
      exitCode?: number;
      sessionId?: string;
    }) => void;
    writeJsonFailure: (args: {
      message: string;
      instruction?: string;
      exitCode?: number;
      errorCode?: string;
      repoPath?: string;
      sessionId?: string;
    }) => void;
    writeUnexpectedError: (args: {
      message: string;
      instruction?: string;
      sessionId?: string;
    }) => void;
  };
}): { ok: true } | { ok: false; exitCode: 1 } {
  if (params.explicitInstruction && params.printInstruction) {
    if (params.headlessOutput) {
      logger.error(text.cli.printInstructionConflict);
      params.headlessErrorWriter.writeUsageError({
        message: text.cli.printInstructionConflict,
        instruction: params.printInstruction,
      });
      return { ok: false, exitCode: 1 };
    }
    logger.error(text.cli.printInstructionConflict, true);
    return { ok: false, exitCode: 1 };
  }

  if (params.continueSession && params.resumeSessionId) {
    if (params.headlessOutput) {
      logger.error(text.cli.continueResumeConflict);
      params.headlessErrorWriter.writeUsageError({
        message: text.cli.continueResumeConflict,
        sessionId: params.resumeSessionId,
        instruction: params.instruction,
      });
      return { ok: false, exitCode: 1 };
    }
    logger.error(text.cli.continueResumeConflict, true);
    return { ok: false, exitCode: 1 };
  }

  if (params.rawOutputProfile && params.outputFormat !== 'stream-json') {
    logger.error(text.cli.outputProfileRequiresStreamJson);
    if (params.outputFormat === 'json') {
      params.headlessErrorWriter.writeJsonFailure({
        sessionId: params.sessionIdForOutput,
        instruction: params.instruction,
        message: text.cli.outputProfileRequiresStreamJson,
        exitCode: 1,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.outputFormat === 'stream-json') {
    const outputProfile = params.outputProfileForStreamJson;
    if (outputProfile !== 'native' && outputProfile !== 'anthropic' && outputProfile !== 'openai') {
      logger.error(text.cli.invalidOutputProfile(outputProfile));
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.invalidOutputProfile(outputProfile),
      });
      return { ok: false, exitCode: 1 };
    }
  }

  if (params.jsonSchemaSpec && params.outputFormat !== 'json') {
    logger.error(text.cli.jsonSchemaRequiresJsonOutput);
    if (params.outputFormat === 'stream-json') {
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput,
        message: text.cli.jsonSchemaRequiresJsonOutput,
        instruction: params.instruction,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  return { ok: true };
}
