import { createHash } from 'crypto';

import { getPromptCachingManager } from '../context/cache/prompt-caching.js';
import type { ArtifactHandle } from '../sub-agent/artifacts/types.js';
import type {
  LLMMessage,
  LLMProviderHints,
  PromptCacheEligibility,
  PromptCacheMode,
} from '../types/llm.js';

import type { ToolCallingAuditEntry } from './audit.js';

export interface RequestAttachment {
  key: string;
  kind: 'context' | 'plan' | 'artifact' | 'note';
  label?: string;
  content: string;
  cacheSafe?: boolean;
  artifactHandle?: string;
  mimeType?: string;
  size?: number;
}

export interface CacheSafeSurface {
  systemSections: string[];
  attachments: RequestAttachment[];
  contextHash?: string;
  namespace?: string;
  mode: PromptCacheMode;
  cacheEligibility: PromptCacheEligibility;
  cacheSafeFingerprint?: string;
  lateInjectionFingerprint?: string;
}

export interface RequestEnvelope {
  systemSections: string[];
  userPrompt: string;
  userMetaMessages: LLMMessage[];
  conversationMessages: LLMMessage[];
  attachments: RequestAttachment[];
  providerHints: LLMProviderHints;
  cacheSafeSurface: CacheSafeSurface;
}

export interface RequestArtifactHints {
  verifyArtifact?: ArtifactHandle;
  subAgentPatchArtifacts?: ArtifactHandle[];
  subAgentAuditArtifacts?: ArtifactHandle[];
  recentReadArtifacts?: Array<{
    path: string;
    artifact: ArtifactHandle;
  }>;
  toolResultPreviewArtifacts?: Array<{
    label: string;
    artifact: ArtifactHandle;
  }>;
}

function isArtifactHandle(value: unknown): value is ArtifactHandle {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    handle?: unknown;
    mimeType?: unknown;
    sha256?: unknown;
    size?: unknown;
  };
  return (
    typeof candidate.handle === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.size === 'number'
  );
}

function mergeArtifactHandles(
  existing: ArtifactHandle[] | undefined,
  incoming: ArtifactHandle[] | undefined,
  limit = 4,
): ArtifactHandle[] | undefined {
  const merged: ArtifactHandle[] = [];
  const seen = new Set<string>();

  for (const artifact of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!artifact || seen.has(artifact.handle)) continue;
    seen.add(artifact.handle);
    merged.push(artifact);
  }

  if (merged.length === 0) return undefined;
  return merged.slice(-limit);
}

function mergeReadArtifactRefs(
  existing:
    | Array<{
        path: string;
        artifact: ArtifactHandle;
      }>
    | undefined,
  incoming:
    | Array<{
        path: string;
        artifact: ArtifactHandle;
      }>
    | undefined,
  limit = 6,
):
  | Array<{
      path: string;
      artifact: ArtifactHandle;
    }>
  | undefined {
  const merged: Array<{ path: string; artifact: ArtifactHandle }> = [];
  const seen = new Set<string>();

  for (const item of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!item?.path || !item.artifact?.handle) continue;
    const key = `${item.path}::${item.artifact.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  if (merged.length === 0) return undefined;
  return merged.slice(-limit);
}

function mergePreviewArtifactRefs(
  existing:
    | Array<{
        label: string;
        artifact: ArtifactHandle;
      }>
    | undefined,
  incoming:
    | Array<{
        label: string;
        artifact: ArtifactHandle;
      }>
    | undefined,
  limit = 6,
):
  | Array<{
      label: string;
      artifact: ArtifactHandle;
    }>
  | undefined {
  const merged: Array<{ label: string; artifact: ArtifactHandle }> = [];
  const seen = new Set<string>();

  for (const item of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!item?.label || !item.artifact?.handle) continue;
    const key = `${item.label}::${item.artifact.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  if (merged.length === 0) return undefined;
  return merged.slice(-limit);
}

export function resolveRequestArtifactHints(params: {
  artifactHints?: RequestArtifactHints;
  toolCallingAudit?: ToolCallingAuditEntry[];
}): RequestArtifactHints | undefined {
  const direct = params.artifactHints;
  const auditEntries = params.toolCallingAudit ?? [];

  const auditPatchArtifacts: ArtifactHandle[] = [];
  const auditAuditArtifacts: ArtifactHandle[] = [];
  const auditReadArtifacts: Array<{ path: string; artifact: ArtifactHandle }> = [];
  const auditPreviewArtifacts: Array<{ label: string; artifact: ArtifactHandle }> = [];

  for (const entry of auditEntries) {
    if (entry?.toolResultStatus === 'ok' && entry.toolName === 'agent_dispatch') {
      if (isArtifactHandle(entry.toolResultPatchArtifact)) {
        auditPatchArtifacts.push(entry.toolResultPatchArtifact);
      }
      if (isArtifactHandle(entry.toolResultAuditArtifact)) {
        auditAuditArtifacts.push(entry.toolResultAuditArtifact);
      }
    }
    if (
      typeof entry.toolResultReadArtifactPath === 'string' &&
      isArtifactHandle(entry.toolResultReadArtifact)
    ) {
      auditReadArtifacts.push({
        path: entry.toolResultReadArtifactPath,
        artifact: entry.toolResultReadArtifact,
      });
    }
    if (
      typeof entry.toolResultPreviewLabel === 'string' &&
      isArtifactHandle(entry.toolResultPreviewArtifact)
    ) {
      auditPreviewArtifacts.push({
        label: entry.toolResultPreviewLabel,
        artifact: entry.toolResultPreviewArtifact,
      });
    }
  }

  const resolved: RequestArtifactHints = {
    verifyArtifact: direct?.verifyArtifact,
    subAgentPatchArtifacts: mergeArtifactHandles(
      direct?.subAgentPatchArtifacts,
      auditPatchArtifacts,
    ),
    subAgentAuditArtifacts: mergeArtifactHandles(
      direct?.subAgentAuditArtifacts,
      auditAuditArtifacts,
    ),
    recentReadArtifacts: mergeReadArtifactRefs(direct?.recentReadArtifacts, auditReadArtifacts),
    toolResultPreviewArtifacts: mergePreviewArtifactRefs(
      direct?.toolResultPreviewArtifacts,
      auditPreviewArtifacts,
    ),
  };

  if (
    !resolved.verifyArtifact &&
    !resolved.subAgentPatchArtifacts?.length &&
    !resolved.subAgentAuditArtifacts?.length &&
    !resolved.recentReadArtifacts?.length &&
    !resolved.toolResultPreviewArtifacts?.length
  ) {
    return undefined;
  }

  return resolved;
}

function toSafeMessage(message: LLMMessage): LLMMessage | null {
  if (!message || typeof message !== 'object') return null;
  if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }
  if (typeof message.content !== 'string') return null;

  const content = message.content.trimEnd();
  if (!content) return null;

  return {
    role: message.role,
    content,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function resolvePromptCacheMode(mode: PromptCacheMode | undefined): PromptCacheMode {
  return mode === 'strict_full_prompt' ? 'strict_full_prompt' : 'cache_safe_only';
}

function serializeAttachmentForFingerprint(item: RequestAttachment): string {
  return [
    item.key,
    item.kind,
    item.label ?? '',
    item.content ?? '',
    item.artifactHandle ?? '',
    item.mimeType ?? '',
    typeof item.size === 'number' ? String(item.size) : '',
  ].join('\u001f');
}

function createFingerprint(parts: string[]): string | undefined {
  if (parts.length === 0) return undefined;
  const hash = createHash('sha256');
  for (const [index, part] of parts.entries()) {
    hash.update(`part:${index}:${part.length}\n`);
    hash.update(part);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function toArtifactAttachment(args: {
  key: string;
  label: string;
  artifact: ArtifactHandle;
}): RequestAttachment {
  return {
    key: args.key,
    kind: 'artifact',
    label: args.label,
    content: '',
    artifactHandle: args.artifact.handle,
    mimeType: args.artifact.mimeType,
    size: args.artifact.size,
  };
}

export function buildArtifactHintAttachments(hints?: RequestArtifactHints): RequestAttachment[] {
  if (!hints) return [];

  const attachments: RequestAttachment[] = [];

  if (hints.verifyArtifact) {
    attachments.push(
      toArtifactAttachment({
        key: 'previous-verify-output',
        label: 'Previous verify output',
        artifact: hints.verifyArtifact,
      }),
    );
  }

  for (const [index, artifact] of (hints.subAgentPatchArtifacts ?? []).entries()) {
    attachments.push(
      toArtifactAttachment({
        key: `previous-subagent-patch-${index}`,
        label: `Previous sub-agent patch artifact ${index + 1}`,
        artifact,
      }),
    );
  }

  for (const [index, artifact] of (hints.subAgentAuditArtifacts ?? []).entries()) {
    attachments.push(
      toArtifactAttachment({
        key: `previous-subagent-audit-${index}`,
        label: `Previous sub-agent audit artifact ${index + 1}`,
        artifact,
      }),
    );
  }

  for (const [index, item] of (hints.recentReadArtifacts ?? []).entries()) {
    attachments.push(
      toArtifactAttachment({
        key: `recent-read-${index}`,
        label: `Recent file read: ${item.path}`,
        artifact: item.artifact,
      }),
    );
  }

  for (const [index, item] of (hints.toolResultPreviewArtifacts ?? []).entries()) {
    attachments.push(
      toArtifactAttachment({
        key: `tool-result-preview-${index}`,
        label: item.label,
        artifact: item.artifact,
      }),
    );
  }

  return attachments;
}

function buildPromptCachingHints(surface: CacheSafeSurface): LLMProviderHints {
  const policy = {
    mode: surface.mode,
    eligibility: surface.cacheEligibility,
    namespace: surface.namespace,
    contextHash: surface.contextHash,
    cacheSafeFingerprint: surface.cacheSafeFingerprint,
    lateInjectionFingerprint: surface.lateInjectionFingerprint,
  } as const;

  if (
    surface.cacheEligibility !== 'eligible' ||
    !surface.contextHash ||
    !surface.cacheSafeFingerprint
  ) {
    return {
      openAICachePolicy: policy,
    };
  }

  const components = [surface.contextHash, `stable:${surface.cacheSafeFingerprint}`];
  if (surface.mode === 'strict_full_prompt' && surface.lateInjectionFingerprint) {
    components.push(`late:${surface.lateInjectionFingerprint}`);
  }

  const manager = getPromptCachingManager();
  return {
    openAICacheHint: manager.generateOpenAICacheHint(
      surface.namespace ?? 'request-envelope',
      components,
    ),
    openAICachePolicy: policy,
  };
}

export function buildRequestEnvelope(params: {
  system: string | string[];
  user: string;
  conversationContext?: LLMMessage[];
  attachments?: RequestAttachment[];
  providerHints?: LLMProviderHints;
  cacheSafeSurface?: {
    contextHash?: string;
    namespace?: string;
    mode?: PromptCacheMode;
  };
}): RequestEnvelope {
  const systemSections = (Array.isArray(params.system) ? params.system : [params.system]).map(
    (item) => String(item ?? '').trimEnd(),
  );
  const attachments = Array.isArray(params.attachments)
    ? params.attachments
        .filter(
          (item) =>
            item && (typeof item.content === 'string' || typeof item.artifactHandle === 'string'),
        )
        .map((item) => ({
          ...item,
          content: typeof item.content === 'string' ? item.content.trimEnd() : '',
        }))
        .filter((item) => item.content.length > 0 || typeof item.artifactHandle === 'string')
    : [];

  const userMetaMessages: LLMMessage[] = [];
  const conversationMessages: LLMMessage[] = [];

  if (Array.isArray(params.conversationContext)) {
    for (const message of params.conversationContext) {
      const safe = toSafeMessage(message);
      if (!safe) continue;
      if (safe.role === 'system') {
        userMetaMessages.push(safe);
        continue;
      }
      conversationMessages.push(safe);
    }
  }

  const cacheMode = resolvePromptCacheMode(params.cacheSafeSurface?.mode);
  const cacheSafeAttachments = attachments.filter((item) => item.cacheSafe);
  const lateInjectionAttachments = attachments.filter((item) => !item.cacheSafe);
  const cacheSafeFingerprint = createFingerprint([
    ...systemSections.map((section, index) => `system:${index}\u001f${section}`),
    ...cacheSafeAttachments.map(
      (item, index) => `attachment:${index}\u001f${serializeAttachmentForFingerprint(item)}`,
    ),
  ]);
  const lateInjectionFingerprint = createFingerprint([
    `userPrompt\u001f${String(params.user ?? '').trimEnd()}`,
    ...userMetaMessages.map((message, index) => `meta:${index}\u001f${message.content}`),
    ...conversationMessages.map(
      (message, index) => `conversation:${index}\u001f${message.role}\u001f${message.content}`,
    ),
    ...lateInjectionAttachments.map(
      (item, index) => `late-attachment:${index}\u001f${serializeAttachmentForFingerprint(item)}`,
    ),
  ]);
  const cacheSafeText = [...systemSections, ...cacheSafeAttachments.map((item) => item.content)]
    .filter(Boolean)
    .join('\n\n');
  const manager = getPromptCachingManager();
  const cacheEligibility: PromptCacheEligibility = !params.cacheSafeSurface?.contextHash
    ? 'missing_context_hash'
    : !cacheSafeText.trim()
      ? 'empty_cache_safe_surface'
      : !manager.shouldCache(estimateTokens(cacheSafeText))
        ? 'below_min_tokens'
        : 'eligible';

  const cacheSafeSurface: CacheSafeSurface = {
    systemSections,
    attachments: cacheSafeAttachments,
    contextHash: params.cacheSafeSurface?.contextHash,
    namespace: params.cacheSafeSurface?.namespace,
    mode: cacheMode,
    cacheEligibility,
    cacheSafeFingerprint,
    lateInjectionFingerprint,
  };

  return {
    systemSections,
    userPrompt: String(params.user ?? ''),
    userMetaMessages,
    conversationMessages,
    attachments,
    providerHints: {
      ...buildPromptCachingHints(cacheSafeSurface),
      ...(params.providerHints ?? {}),
    },
    cacheSafeSurface,
  };
}

export function materializeRequestEnvelope(envelope: RequestEnvelope): LLMMessage[] {
  const artifactSection = (() => {
    const artifactAttachments = envelope.attachments.filter(
      (item) =>
        item.kind === 'artifact' && typeof item.artifactHandle === 'string' && item.artifactHandle,
    );
    if (artifactAttachments.length === 0) return '';

    const lines = [
      '# Available Artifacts',
      'Use `artifact.read` with these handles when you need the full artifact contents.',
    ];

    for (const item of artifactAttachments) {
      const suffix = [
        item.mimeType ? `mime=${item.mimeType}` : undefined,
        typeof item.size === 'number' ? `size=${item.size}` : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(
        `- ${item.label ?? item.key}: ${item.artifactHandle}${suffix ? ` (${suffix})` : ''}`,
      );
    }

    return lines.join('\n');
  })();

  const out: LLMMessage[] = [
    {
      role: 'system',
      content: envelope.systemSections.filter(Boolean).join('\n\n'),
    },
  ];

  out.push(...envelope.userMetaMessages);
  out.push(...envelope.conversationMessages);
  out.push({
    role: 'user',
    content:
      artifactSection.trim().length > 0
        ? `${String(envelope.userPrompt ?? '')}\n\n${artifactSection}`
        : String(envelope.userPrompt ?? ''),
  });

  return out;
}
