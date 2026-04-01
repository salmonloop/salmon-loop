import { text } from '../../../locales/index.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { buildRequestEnvelope, materializeRequestEnvelope } from '../../llm/request-envelope.js';
import { formatContextForPrompt } from '../../llm/utils.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import type {
  ExploreCtx,
  ResearchCtx,
  ResearchFinding,
  ResearchSource,
} from '../engine/pipeline/types.js';

type ResearchResponse = {
  researchNotes?: unknown;
  researchFindings?: unknown;
  sources?: unknown;
  researchText?: unknown;
};

function buildResearchPrompt(contextText: string, instruction: string): string {
  return [
    'You are running in deep research mode.',
    'Use available tools to gather external information as needed.',
    'Return JSON with keys: researchNotes, researchFindings, sources, researchText.',
    'Each researchFinding should include: summary, confidence (0-1), uncertainty (string).',
    'Each source should include: toolName, summary, ok, timestamp (epoch ms).',
    '',
    `Instruction:\n${instruction}`,
    '',
    `Context:\n${contextText}`,
  ].join('\n');
}

function normalizeFindings(value: unknown): ResearchFinding[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return { summary: item };
        if (item && typeof item === 'object') return item as ResearchFinding;
        return { summary: String(item) };
      })
      .filter((item) => Boolean(item.summary));
  }
  if (typeof value === 'string') return [{ summary: value }];
  if (typeof value === 'object') return [value as ResearchFinding];
  return [{ summary: String(value) }];
}

function normalizeSources(value: unknown, fallback: ResearchSource[]): ResearchSource[] {
  if (!value) return fallback;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') return item as ResearchSource;
        return undefined;
      })
      .filter(Boolean) as ResearchSource[];
  }
  if (typeof value === 'object') return [value as ResearchSource];
  return fallback;
}

function parseResearchResponse(
  content: string,
  fallbackSources: ResearchSource[],
): Pick<ResearchCtx, 'researchNotes' | 'researchFindings' | 'sources' | 'researchText'> {
  let parsed: ResearchResponse | undefined;
  try {
    parsed = JSON.parse(content) as ResearchResponse;
  } catch {
    parsed = undefined;
  }

  const researchText = String(parsed?.researchText ?? content ?? text.grizzco.research.empty ?? '');
  const researchNotes = Array.isArray(parsed?.researchNotes)
    ? parsed?.researchNotes
    : parsed?.researchNotes
      ? [parsed?.researchNotes]
      : [];
  const researchFindings = normalizeFindings(parsed?.researchFindings ?? parsed);
  const sources = normalizeSources(parsed?.sources, fallbackSources);

  return {
    researchNotes,
    researchFindings,
    sources,
    researchText,
  };
}

function buildSourcesFromAudit(
  entries: {
    toolName: string;
    rawArgsPreview?: string;
    parsedArgsPreview?: string;
    toolResultStatus?: string;
    timestamp: string;
  }[],
): ResearchSource[] {
  return entries.map((entry) => ({
    toolName: entry.toolName,
    summary: entry.parsedArgsPreview || entry.rawArgsPreview,
    ok: entry.toolResultStatus === 'ok',
    timestamp: Number.isFinite(Date.parse(entry.timestamp))
      ? Date.parse(entry.timestamp)
      : Date.now(),
  }));
}

export async function generateResearch(ctx: ExploreCtx): Promise<ResearchCtx> {
  const contextText = ctx.contextResult?.prompt ?? formatContextForPrompt(ctx.context);
  const prompt = buildResearchPrompt(contextText, ctx.options.instruction);
  const systemPrompt = 'You are a research assistant. Prefer evidence-backed claims.';
  const envelope = buildRequestEnvelope({
    system: systemPrompt,
    user: prompt,
    conversationContext: ctx.options.conversationContext,
    attachments: [
      {
        key: 'context-prompt',
        kind: 'context',
        label: 'Context prompt',
        content: contextText,
        cacheSafe: true,
      },
      ...(ctx.artifactHints?.verifyArtifact
        ? [
            {
              key: 'previous-verify-output',
              kind: 'artifact' as const,
              label: 'Previous verify output',
              content: '',
              artifactHandle: ctx.artifactHints.verifyArtifact.handle,
              mimeType: ctx.artifactHints.verifyArtifact.mimeType,
              size: ctx.artifactHints.verifyArtifact.size,
            },
          ]
        : []),
    ],
    cacheSafeSurface: {
      contextHash: ctx.contextResult?.meta?.contextHash ?? ctx.context.contextHash,
      namespace: 'research',
    },
  });
  const baseMessages = materializeRequestEnvelope(envelope);

  const toolPolicy = resolveLlmToolCallingPolicy(Phase.RESEARCH, ctx.options.llm);
  const supportsStreaming = typeof ctx.options.llm.chatStream === 'function';

  const localAudit: any[] = [];
  const sourcesFromAudit = () => buildSourcesFromAudit(localAudit as any);

  if (!ctx.toolstack || !toolPolicy.enabled) {
    const response = await ctx.options.llm.chat(baseMessages, {
      providerHints: envelope.providerHints,
      signal: ctx.options.signal,
      phase: Phase.RESEARCH,
    });

    if (!response?.content) {
      throw new Error(text.llm.reviewEmpty);
    }

    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'research',
      step: 'RESEARCH',
      content: response.content,
    });

    const parsed = parseResearchResponse(response.content, []);
    const timestamp = Date.now();
    return {
      ...ctx,
      ...parsed,
      report: {
        kind: 'research',
        summary: parsed.researchText,
        findings: parsed.researchFindings,
        timestamp,
      },
    } as ResearchCtx;
  }

  const llmOutput = {
    policy: ctx.options.llmOutput,
    kind: 'research' as const,
    step: 'RESEARCH' as const,
  };

  const response = await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
    baseMessages,
    { providerHints: envelope.providerHints, signal: ctx.options.signal },
    {
      phase: Phase.RESEARCH,
      llm: ctx.options.llm,
      runtime: {
        repoRoot: ctx.workspace.workPath,
        persistenceRoot: ctx.workspace.baseRepoPath || ctx.workspace.workPath,
        worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
        attemptId: ctx.attempt ?? 1,
        dryRun: Boolean(ctx.options?.dryRun),
        llm: ctx.options.llm,
        model:
          ctx.options.llm.getModelId?.() || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL,
        userInputProvider: ctx.options.userInputProvider,
        agentKind: ctx.options.agentKind ?? 'primary',
        languagePlugins: ctx.options.languagePlugins,
        subAgentController: ctx.options.subAgentController,
      },
      toolstack: ctx.toolstack,
      eventPayload: ctx.options.eventPayload,
      toolCallingAudit: {
        event: (entry) => {
          localAudit.push(entry);
          const list = ctx.toolCallingAudit ?? [];
          list.push(entry);
          ctx.toolCallingAudit = list;
        },
      },
      maxRounds: toolPolicy.maxRounds,
      llmOutput,
      emit: (event) => ctx.emit({ ...event, timestamp: event.timestamp ?? new Date() }),
    },
  );

  if (!response?.content) {
    throw new Error(text.llm.reviewEmpty);
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.research.generated,
    timestamp: new Date(),
  });

  const parsed = parseResearchResponse(response.content, sourcesFromAudit());
  const timestamp = Date.now();
  return {
    ...ctx,
    ...parsed,
    report: {
      kind: 'research',
      summary: parsed.researchText,
      findings: parsed.researchFindings,
      timestamp,
    },
  } as ResearchCtx;
}
