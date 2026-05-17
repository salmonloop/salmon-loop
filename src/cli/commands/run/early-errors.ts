import { getLogger } from '../../../core/facades/cli-observability.js';
import { text } from '../../locales/index.js';

export function handleEarlyRunCommandErrors(params: {
  headlessOutput: boolean;
  outputFormat: 'text' | 'json' | 'stream-json';
  rawOutputProfile?: string;
  outputProfileForStreamJson: string;
  headlessIncludeToolInput: boolean;
  headlessIncludeToolOutput: boolean;
  headlessIncludeAuthorizationDecisions: boolean;
  instruction?: string;
  printInstruction?: string;
  explicitInstruction?: string;
  continueSession: boolean;
  resumeSessionId?: string;
  jsonSchemaSpec?: string;
  sweBenchInstanceId?: string;
  sweBenchModelName?: string;
  sweBenchPredictionsPath?: string;
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
  if (
    (params.headlessIncludeToolInput || params.headlessIncludeToolOutput) &&
    params.outputFormat !== 'stream-json'
  ) {
    getLogger().error(text.cli.headlessToolPayloadRequiresStreamJson);
    if (params.headlessOutput) {
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.headlessToolPayloadRequiresStreamJson,
        instruction: params.instruction,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.headlessIncludeAuthorizationDecisions && params.outputFormat === 'text') {
    getLogger().error(text.cli.headlessAuthorizationDecisionsRequireHeadlessOutput);
    if (params.headlessOutput) {
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.headlessAuthorizationDecisionsRequireHeadlessOutput,
        instruction: params.instruction,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.explicitInstruction && params.printInstruction) {
    if (params.headlessOutput) {
      getLogger().error(text.cli.printInstructionConflict);
      params.headlessErrorWriter.writeUsageError({
        message: text.cli.printInstructionConflict,
        instruction: params.printInstruction,
      });
      return { ok: false, exitCode: 1 };
    }
    getLogger().error(text.cli.printInstructionConflict, true);
    return { ok: false, exitCode: 1 };
  }

  if (params.continueSession && params.resumeSessionId) {
    if (params.headlessOutput) {
      getLogger().error(text.cli.continueResumeConflict);
      params.headlessErrorWriter.writeUsageError({
        message: text.cli.continueResumeConflict,
        sessionId: params.resumeSessionId,
        instruction: params.instruction,
      });
      return { ok: false, exitCode: 1 };
    }
    getLogger().error(text.cli.continueResumeConflict, true);
    return { ok: false, exitCode: 1 };
  }

  if (params.rawOutputProfile && params.outputFormat !== 'stream-json') {
    getLogger().error(text.cli.outputProfileRequiresStreamJson);
    if (params.outputFormat === 'json') {
      params.headlessErrorWriter.writeJsonFailure({
        sessionId: params.sessionIdForOutput,
        instruction: params.instruction,
        message: text.cli.outputProfileRequiresStreamJson,
        exitCode: 1,
        errorCode: 'USAGE_ERROR',
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.outputFormat === 'stream-json') {
    const outputProfile = params.outputProfileForStreamJson;
    if (outputProfile !== 'native' && outputProfile !== 'anthropic' && outputProfile !== 'openai') {
      getLogger().error(text.cli.invalidOutputProfile(outputProfile));
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.invalidOutputProfile(outputProfile),
      });
      return { ok: false, exitCode: 1 };
    }

    if (
      outputProfile === 'openai' &&
      (params.headlessIncludeToolInput || params.headlessIncludeToolOutput)
    ) {
      getLogger().error(text.cli.headlessToolPayloadNotSupportedWithOpenAiProfile);
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.headlessToolPayloadNotSupportedWithOpenAiProfile,
        instruction: params.instruction,
      });
      return { ok: false, exitCode: 1 };
    }

    if (
      params.headlessIncludeAuthorizationDecisions &&
      (outputProfile === 'anthropic' || outputProfile === 'openai')
    ) {
      getLogger().error(text.cli.headlessAuthorizationDecisionsNotSupportedWithStrictProfiles);
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.headlessAuthorizationDecisionsNotSupportedWithStrictProfiles,
        instruction: params.instruction,
      });
      return { ok: false, exitCode: 1 };
    }
  }

  if (params.jsonSchemaSpec && params.outputFormat !== 'json') {
    getLogger().error(text.cli.jsonSchemaRequiresJsonOutput);
    if (params.outputFormat === 'stream-json') {
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput,
        message: text.cli.jsonSchemaRequiresJsonOutput,
        instruction: params.instruction,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.sweBenchPredictionsPath && !params.sweBenchInstanceId) {
    getLogger().error(text.cli.sweBenchInstanceRequired);
    if (params.headlessOutput) {
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.sweBenchInstanceRequired,
        instruction: params.instruction,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.sweBenchPredictionsPath && !params.sweBenchModelName) {
    getLogger().error(text.cli.sweBenchModelRequired);
    if (params.headlessOutput) {
      params.headlessErrorWriter.writeUsageError({
        sessionId: params.sessionIdForOutput ?? params.resumeSessionId,
        message: text.cli.sweBenchModelRequired,
        instruction: params.instruction,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  return { ok: true };
}
