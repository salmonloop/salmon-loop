import { emitLlmOutput } from '../../llm/output-policy.js';
import { getAnswerSystemPrompt } from '../../prompts/runtime.js';
import { chatWithTools } from '../../tools/session.js';
import { Phase, type LLM } from '../../types/index.js';
import type { AnswerCtx, PreflightCtx } from '../engine/pipeline/types.js';

import { buildSharedRequestEnvelope } from './request-assembly.js';

export async function generateAnswer(ctx: PreflightCtx): Promise<AnswerCtx> {
  const instruction = String(ctx.options.instruction ?? '').trim();
  if (!instruction) {
    return {
      ...ctx,
      report: { kind: 'answer', summary: '', timestamp: Date.now() },
    };
  }

  const shared = buildSharedRequestEnvelope({
    defaultNamespace: 'answer',
    systemPrompt: await getAnswerSystemPrompt(),
    userPrompt: instruction,
    conversationContext: ctx.options.conversationContext,
  });
  const messages = shared.baseMessages;

  const llmClient: LLM = ctx.options.llm;
  const supportsTools = Boolean(ctx.toolstack);

  const assistant = supportsTools
    ? await chatWithTools(
        messages,
        {
          providerHints: shared.envelope.providerHints,
          temperature: 0.2,
          signal: ctx.options.signal,
        },
        {
          phase: Phase.EXPLORE,
          llm: llmClient,
          runtime: {
            repoRoot: ctx.workspace.workPath,
            persistenceRoot: ctx.workspace.baseRepoPath || ctx.workspace.workPath,
            attemptId: ctx.attempt ?? 1,
            dryRun: Boolean(ctx.options?.dryRun),
            model: llmClient.getModelId?.(),
            languagePlugins: ctx.options.languagePlugins,
            subAgentController: ctx.options.subAgentController,
          },
          toolstack: ctx.toolstack!,
          emit: ctx.emit,
          llmOutput: {
            policy: ctx.options.llmOutput,
            kind: 'assistant_message',
            step: 'REPORT',
          },
        },
      )
    : await llmClient.chat(messages, {
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

  return {
    ...ctx,
    report: {
      kind: 'answer',
      summary: content,
      timestamp: Date.now(),
    },
  };
}
