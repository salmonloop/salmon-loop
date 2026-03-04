import type { ChatSessionManager } from '../../../core/session/manager.js';
import { refreshSessionSummary } from '../../../core/session/summary-sync.js';
import type { LLM } from '../../../core/types/llm.js';
import type { LoopResult } from '../../../core/types/loop.js';

export async function persistRunSession(params: {
  sessionManager?: ChatSessionManager;
  llm: LLM;
  instruction?: string;
  result: LoopResult;
  buildAssistantMessage: (result: LoopResult) => string;
}) {
  if (!params.sessionManager || typeof params.instruction !== 'string') return;

  try {
    params.sessionManager.addMessage({
      role: 'user',
      content: params.instruction,
      timestamp: Date.now(),
    });

    let iterationId: string | undefined;
    if (Array.isArray(params.result.history) && params.result.history.length > 0) {
      iterationId = params.sessionManager.addIteration(
        params.result.history[params.result.history.length - 1],
      );
    }

    if (params.result.reason !== 'Operation cancelled by user') {
      params.sessionManager.addMessage({
        role: 'assistant',
        content: params.buildAssistantMessage(params.result),
        timestamp: Date.now(),
        iterationId,
      });
    }

    await refreshSessionSummary({
      sessionManager: params.sessionManager,
      llm: params.llm,
      contextHash: params.result.contextHash,
      strategy: 'force',
    });
    await params.sessionManager.save();
  } catch {
    // Best-effort persistence: never block the CLI exit path.
  }
}
