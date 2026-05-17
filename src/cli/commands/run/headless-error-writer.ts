import { randomUUID } from 'crypto';

import {
  getExitCode,
  type LoopResult,
} from '../../../core/facades/cli-run-headless-error-writer.js';
import {
  encodeAnthropicEnd,
  encodeAnthropicError,
  encodeAnthropicStart,
} from '../../headless/anthropic-stream-protocol.js';
import { encodeJsonFailure } from '../../headless/json-protocol.js';
import { OpenAiStreamEncoder } from '../../headless/openai-stream-encoder.js';
import type { StdoutWriter } from '../../headless/stdout-writer.js';
import {
  encodeStreamEnd,
  encodeStreamFailure,
  encodeStreamStart,
} from '../../headless/stream-json-protocol.js';

import type { OutputFormat } from './types.js';

export interface HeadlessErrorWriterContext {
  repoPath: string;
  outputFormat: OutputFormat;
  outputProfileForStreamJson: string;
  writer: StdoutWriter;
  getSessionId: () => string | undefined;
  getResumeSessionId: () => string | undefined;
}

function writeStreamJsonEarlyFailure(params: {
  writer: StdoutWriter;
  repoPath: string;
  sessionId: string;
  message: string;
  auditPath?: string;
  exitCode?: number;
  instruction?: string;
}) {
  const at = new Date();
  let eventSeq = 0;
  params.writer.writeJsonLine(
    encodeStreamStart({
      uuid: randomUUID(),
      mode: 'run',
      repoPath: params.repoPath,
      sessionId: params.sessionId,
      instruction: params.instruction,
      at,
      eventSeq: eventSeq++,
    }),
  );
  params.writer.writeJsonLine(
    encodeStreamFailure({
      uuid: randomUUID(),
      sessionId: params.sessionId,
      at,
      message: params.message,
      auditPath: params.auditPath,
      eventSeq: eventSeq++,
    }),
  );
  params.writer.writeJsonLine(
    encodeStreamEnd({
      uuid: randomUUID(),
      sessionId: params.sessionId,
      at,
      success: false,
      exitCode: params.exitCode ?? 1,
      eventSeq: eventSeq++,
    }),
  );
}

function writeAnthropicEarlyFailure(params: {
  writer: StdoutWriter;
  repoPath: string;
  sessionId: string;
  message: string;
  exitCode?: number;
  instruction?: string;
}) {
  params.writer.writeJsonLine(
    encodeAnthropicStart({
      sessionId: params.sessionId,
      mode: 'run',
      repoPath: params.repoPath,
      instruction: params.instruction,
    }),
  );
  params.writer.writeJsonLine(
    encodeAnthropicError({
      sessionId: params.sessionId,
      message: params.message,
    }),
  );
  params.writer.writeJsonLine(
    encodeAnthropicEnd({
      sessionId: params.sessionId,
      loopResult: {
        success: false,
        reason: params.message,
        errorCode: 'USAGE_ERROR',
      } as any,
    }),
  );
}

function writeOpenAiEarlyFailure(params: {
  writer: StdoutWriter;
  message: string;
  exitCode?: number;
}) {
  const encoder = new OpenAiStreamEncoder({
    now: () => new Date(),
    model: 'unknown',
    responseId: () => `resp_${randomUUID().replace(/-/g, '')}`,
    itemId: () => `msg_${randomUUID().replace(/-/g, '')}`,
  });

  const code = params.exitCode === 1 ? 'usage_error' : null;
  for (const event of encoder.usageError({ message: params.message, code })) {
    params.writer.writeJsonLine(event);
  }
}

function writeOpenAiUnexpectedFailure(params: { writer: StdoutWriter; message: string }) {
  const encoder = new OpenAiStreamEncoder({
    now: () => new Date(),
    model: 'unknown',
    responseId: () => `resp_${randomUUID().replace(/-/g, '')}`,
    itemId: () => `msg_${randomUUID().replace(/-/g, '')}`,
  });

  for (const event of encoder.crash(new Error(params.message))) {
    params.writer.writeJsonLine(event);
  }
}

function resolveSessionId(ctx: HeadlessErrorWriterContext, override?: string): string {
  return override ?? ctx.getResumeSessionId() ?? ctx.getSessionId() ?? randomUUID();
}

export function createHeadlessErrorWriter(ctx: HeadlessErrorWriterContext) {
  const writeJsonFailure = (params: {
    message: string;
    instruction?: string;
    exitCode?: number;
    errorCode?: string;
    auditPath?: string;
    repoPath?: string;
    sessionId?: string;
  }) => {
    const sessionId = resolveSessionId(ctx, params.sessionId);
    ctx.writer.writeJsonLine(
      encodeJsonFailure({
        mode: 'run',
        repoPath: params.repoPath ?? ctx.repoPath,
        sessionId,
        instruction: params.instruction,
        message: params.message,
        errorCode: params.errorCode,
        auditPath: params.auditPath,
        exitCode: params.exitCode ?? 1,
      }),
    );
  };

  const writeUsageError = (params: {
    message: string;
    instruction?: string;
    exitCode?: number;
    sessionId?: string;
  }) => {
    const sessionId = resolveSessionId(ctx, params.sessionId);
    const exitCode = params.exitCode ?? 1;

    if (ctx.outputFormat === 'json') {
      writeJsonFailure({
        message: params.message,
        instruction: params.instruction,
        exitCode,
        errorCode: 'USAGE_ERROR',
        sessionId,
      });
      return;
    }

    if (ctx.outputFormat === 'stream-json') {
      if (ctx.outputProfileForStreamJson === 'anthropic') {
        writeAnthropicEarlyFailure({
          writer: ctx.writer,
          repoPath: ctx.repoPath,
          sessionId,
          message: params.message,
          exitCode,
          instruction: params.instruction,
        });
      } else if (ctx.outputProfileForStreamJson === 'openai') {
        writeOpenAiEarlyFailure({
          writer: ctx.writer,
          message: params.message,
          exitCode,
        });
      } else {
        writeStreamJsonEarlyFailure({
          writer: ctx.writer,
          repoPath: ctx.repoPath,
          sessionId,
          message: params.message,
          exitCode,
          instruction: params.instruction,
        });
      }
    }
  };

  const writeUnexpectedError = (params: {
    message: string;
    instruction?: string;
    auditPath?: string;
    sessionId?: string;
  }) => {
    const sessionId = resolveSessionId(ctx, params.sessionId);

    if (ctx.outputFormat === 'json') {
      writeJsonFailure({
        message: params.message,
        repoPath: ctx.repoPath,
        instruction: params.instruction,
        auditPath: params.auditPath,
        sessionId,
      });
      return;
    }

    if (ctx.outputFormat === 'stream-json') {
      if (ctx.outputProfileForStreamJson === 'anthropic') {
        writeAnthropicEarlyFailure({
          writer: ctx.writer,
          repoPath: ctx.repoPath,
          sessionId,
          message: params.message,
          instruction: params.instruction,
        });
      } else if (ctx.outputProfileForStreamJson === 'openai') {
        writeOpenAiUnexpectedFailure({
          writer: ctx.writer,
          message: params.message,
        });
      } else {
        writeStreamJsonEarlyFailure({
          writer: ctx.writer,
          repoPath: ctx.repoPath,
          sessionId,
          message: params.message,
          auditPath: params.auditPath,
          instruction: params.instruction,
        });
      }
    }
  };

  const resolveExitCode = (result: LoopResult): number => getExitCode(result);

  const writeResultExitCode = (result: LoopResult, structuredOk: boolean): number => {
    return result.success && !structuredOk ? 1 : resolveExitCode(result);
  };

  return {
    writeJsonFailure,
    writeUsageError,
    writeUnexpectedError,
    writeResultExitCode,
  };
}
