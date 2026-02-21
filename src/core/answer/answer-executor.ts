import { randomBytes } from 'crypto';

import { composeChatMessages } from '../llm/message-composition.js';
import {
  clearAuditContext,
  clearAuditTrail,
  setAuditContext,
} from '../observability/audit-trail.js';
import type { ToolAuthorizationProvider } from '../tools/authorization/types.js';
import { createStandardToolstack } from '../tools/loader.js';
import { chatWithTools } from '../tools/session.js';
import {
  Phase,
  type LLM,
  type LLMMessage,
  type LoopEvent,
  type LlmOutputPolicy,
} from '../types/index.js';

export interface AnswerExecutorOptions {
  repoPath: string;
  llm: LLM;
  instruction: string;
  conversationContext?: LLMMessage[];
  emit?: (event: LoopEvent) => void;
  signal?: AbortSignal;
  llmOutputPolicy?: LlmOutputPolicy;
  authorizationProvider?: ToolAuthorizationProvider;
  authorizationMode?: 'blocking' | 'deferred';
  allowedToolNames?: string[];
}

export interface AnswerResult {
  content: string;
}

const DEFAULT_ALLOWED_TOOLS: string[] = [
  'code.search',
  'fs.read',
  'fs.list',
  'code.read',
  'git.status',
  'git.cat',
];

function buildSystemPrompt(): string {
  return [
    'You are a coding assistant in "answer" mode.',
    'You may use read-only tools to inspect the repository when helpful.',
    'Never write files, never apply patches, and never run shell commands.',
    'Answer in the same language as the user.',
  ].join('\n');
}

export async function runAnswerExecutor(options: AnswerExecutorOptions): Promise<AnswerResult> {
  clearAuditTrail();
  const correlationId = `answer-${randomBytes(4).toString('hex')}`;
  setAuditContext({ correlationId, scope: 'session' });

  try {
    if (!options.instruction.trim()) return { content: '' };

    const toolstack = await createStandardToolstack({
      repoRoot: options.repoPath,
      persistenceRoot: options.repoPath,
      attemptId: 0,
      dryRun: false,
      allowedToolNames: options.allowedToolNames ?? DEFAULT_ALLOWED_TOOLS,
      authorizationProvider: options.authorizationProvider,
      authorizationMode: options.authorizationMode ?? 'deferred',
    });

    const messages = composeChatMessages({
      system: buildSystemPrompt(),
      user: options.instruction,
      conversationContext: options.conversationContext,
    });

    const assistant = await chatWithTools(
      messages,
      { temperature: 0.2, signal: options.signal },
      {
        phase: Phase.SLASH,
        llm: options.llm,
        runtime: {
          repoRoot: options.repoPath,
          persistenceRoot: options.repoPath,
          attemptId: 0,
          dryRun: false,
          model: options.llm.getModelId?.(),
        },
        toolstack,
        emit: options.emit,
        llmOutput: {
          policy: options.llmOutputPolicy,
          kind: 'assistant_message',
          step: 'REPORT',
        },
      },
    );

    return { content: assistant.content || '' };
  } finally {
    clearAuditContext();
  }
}
