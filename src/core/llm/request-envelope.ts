import { getPromptCachingManager } from '../context/cache/prompt-caching.js';
import type { LLMMessage, LLMProviderHints } from '../types/llm.js';

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

function buildPromptCachingHints(surface: CacheSafeSurface): LLMProviderHints {
  if (!surface.contextHash) return {};

  const stableText = [...surface.systemSections, ...surface.attachments.map((item) => item.content)]
    .filter(Boolean)
    .join('\n\n');
  if (!stableText.trim()) return {};

  const manager = getPromptCachingManager();
  if (!manager.shouldCache(estimateTokens(stableText))) {
    return {};
  }

  return {
    openAICacheHint: manager.prepareOpenAIRequest(
      surface.namespace ?? 'request-envelope',
      surface.contextHash,
    ),
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
  };
}): RequestEnvelope {
  const systemSections = (Array.isArray(params.system) ? params.system : [params.system]).map((item) =>
    String(item ?? '').trimEnd(),
  );
  const attachments = Array.isArray(params.attachments)
    ? params.attachments
        .filter(
          (item) =>
            item &&
            (typeof item.content === 'string' || typeof item.artifactHandle === 'string'),
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

  const cacheSafeSurface: CacheSafeSurface = {
    systemSections,
    attachments: attachments.filter((item) => item.cacheSafe),
    contextHash: params.cacheSafeSurface?.contextHash,
    namespace: params.cacheSafeSurface?.namespace,
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
      (item) => item.kind === 'artifact' && typeof item.artifactHandle === 'string' && item.artifactHandle,
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
