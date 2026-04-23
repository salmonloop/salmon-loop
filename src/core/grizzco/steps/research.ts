import { text } from '../../../locales/index.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { getResearchPrompt, getResearchSystemPrompt } from '../../prompts/runtime.js';
import { SessionReplacementPreviewProvider } from '../../session/replacement-preview-provider.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import { resolveVisibleToolNames } from '../../tools/tool-visibility.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import type {
  ExploreCtx,
  ResearchCtx,
  ResearchFinding,
  ResearchSource,
} from '../engine/pipeline/types.js';

import { buildPhaseRequestEnvelope } from './request-assembly.js';
import { buildPhaseToolRuntimeContext, buildToolVisibilityRuntime } from './tool-runtime.js';

type ResearchResponse = {
  researchNotes?: unknown;
  researchFindings?: unknown;
  sources?: unknown;
  researchText?: unknown;
};

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
  const systemPrompt = await getResearchSystemPrompt();
  const toolVisibility = buildToolVisibilityRuntime(ctx);
  const requestEnvelope = await buildPhaseRequestEnvelope({
    phase: Phase.RESEARCH,
    defaultNamespace: 'research',
    context: ctx.context,
    contextResult: ctx.contextResult,
    cacheSharing: ctx.cacheSharing,
    onCacheMismatch: (mismatch) => {
      recordAuditEvent('request.cache_sharing_hash_mismatch', mismatch, {
        source: 'llm',
        severity: 'low',
        scope: 'session',
        phase: Phase.RESEARCH,
      });
    },
    systemPrompt,
    buildUserPrompt: async (contextText) =>
      await getResearchPrompt(contextText, ctx.options.instruction),
    conversationContext: ctx.options.conversationContext,
    artifactHints: ctx.artifactHints,
    toolCallingAudit: ctx.toolCallingAudit,
    previewProvider: new SessionReplacementPreviewProvider(ctx.replacementState),
    relevantMemory: {
      visibleToolNames: resolveVisibleToolNames({
        phase: Phase.RESEARCH,
        toolstack: ctx.toolstack,
        worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
        flowMode: ctx.mode,
        runtime: toolVisibility,
      }),
    },
  });
  const { cacheSurface, envelope, baseMessages } = requestEnvelope;

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
      runtime: buildPhaseToolRuntimeContext(ctx, Phase.RESEARCH, cacheSurface),
      toolVisibility,
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
