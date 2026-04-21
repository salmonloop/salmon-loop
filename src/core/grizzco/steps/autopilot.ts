import { text } from '../../../locales/index.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { SessionReplacementPreviewProvider } from '../../session/replacement-preview-provider.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import type { LLM } from '../../types/index.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import type { AutopilotCtx, PreflightCtx } from '../engine/pipeline/types.js';

import { buildPhaseToolRuntimeContext } from './tool-runtime.js';
import { buildSharedRequestEnvelope } from './request-assembly.js';
import { executeVerifyForWorkspace } from './verify-shared.js';

const AUTOPILOT_TOOL_PHASE = Phase.AUTOPILOT;

function buildAutopilotSystemPrompt(): string {
  return [
    'You are a coding assistant running in "autopilot" mode.',
    'Drive the task forward autonomously and answer in the same language as the user.',
    'Use the repository context available in the current turn when present.',
    'If no repository action is possible yet, explain the next best action succinctly.',
  ].join('\n');
}

export async function runAutopilot(ctx: PreflightCtx): Promise<AutopilotCtx> {
  const instruction = String(ctx.options.instruction ?? '').trim();
  if (!instruction) {
    return {
      ...ctx,
      mutated: false,
      report: { kind: 'answer', summary: '', timestamp: Date.now() },
    };
  }

  const shared = buildSharedRequestEnvelope({
    defaultNamespace: 'autopilot',
    systemPrompt: buildAutopilotSystemPrompt(),
    userPrompt: instruction,
    conversationContext: ctx.options.conversationContext,
    artifactHints: ctx.artifactHints,
    toolCallingAudit: ctx.toolCallingAudit,
    previewProvider: new SessionReplacementPreviewProvider(ctx.replacementState),
  });

  const llmClient: LLM = ctx.options.llm;
  const toolPolicy = resolveLlmToolCallingPolicy(AUTOPILOT_TOOL_PHASE, llmClient);
  const localAudit: NonNullable<AutopilotCtx['toolCallingAudit']> = [];
  const supportsStreaming = typeof llmClient.chatStream === 'function';
  const supportsTools = Boolean(ctx.toolstack && toolPolicy.enabled);

  const assistant = supportsTools
    ? await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
        shared.baseMessages,
        {
          phase: AUTOPILOT_TOOL_PHASE,
          providerHints: shared.envelope.providerHints,
          temperature: 0.2,
          signal: ctx.options.signal,
        },
        {
          phase: AUTOPILOT_TOOL_PHASE,
          llm: llmClient,
          runtime: buildPhaseToolRuntimeContext(ctx, AUTOPILOT_TOOL_PHASE, shared.cacheSurface),
          toolstack: ctx.toolstack!,
          eventPayload: ctx.options.eventPayload,
          toolCallingAudit: {
            event: (entry) => {
              localAudit.push(entry);
            },
          },
          maxRounds: toolPolicy.maxRounds,
          llmOutput: {
            policy: ctx.options.llmOutput,
            kind: 'assistant_message',
            step: 'REPORT',
          },
          emit: (event) => ctx.emit({ ...event, timestamp: event.timestamp ?? new Date() }),
        },
      )
    : await llmClient.chat(shared.baseMessages, {
        phase: 'AUTOPILOT',
        providerHints: shared.envelope.providerHints,
        temperature: 0.2,
        signal: ctx.options.signal,
        tools: [],
        toolChoice: 'none',
      });

  const content = String((assistant as any)?.content ?? '').trim();

  if (!supportsTools) {
    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'assistant_message',
      step: 'REPORT',
      content,
    });
  }

  const mergedAudit =
    localAudit.length > 0 ? [...(ctx.toolCallingAudit ?? []), ...localAudit] : ctx.toolCallingAudit;
  const mutated = localAudit.some(
    (entry) => entry.toolIntent === 'WRITE' && entry.toolResultStatus === 'ok',
  );

  return {
    ...ctx,
    mutated,
    toolCallingAudit: mergedAudit,
    report: {
      kind: 'answer',
      summary: content,
      timestamp: Date.now(),
    },
  };
}

export async function runAutopilotVerifyGate(ctx: AutopilotCtx): Promise<AutopilotCtx> {
  if (!ctx.mutated) {
    return {
      ...ctx,
      verifyResult: undefined,
    };
  }

  if (!ctx.options.verify) {
    return {
      ...ctx,
      verifyResult: { ok: true, output: text.loop.verificationSkipped, exitCode: null },
    };
  }

  const { verifyResult, verifyArtifact } = await executeVerifyForWorkspace({
    workspacePath: ctx.workspace.workPath,
    verify: ctx.options.verify,
    signal: ctx.options.signal,
  });
  const nextCtx: AutopilotCtx = {
    ...ctx,
    verifyResult,
  };

  return verifyArtifact ? ({ ...nextCtx, verifyArtifact } as AutopilotCtx) : nextCtx;
}
