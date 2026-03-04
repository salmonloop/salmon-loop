import { resolveLlmOutputPolicy } from '../../core/llm/output-policy.js';
import {
  LLM_OUTPUT_KINDS,
  type LlmOutputKind,
  type LlmOutputPolicy,
} from '../../core/types/llm.js';

const ALL_KINDS = [...LLM_OUTPUT_KINDS];

export function parseLlmOutputKinds(
  raw: string,
): { ok: true; kinds: LlmOutputKind[] } | { ok: false; invalid?: string } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { ok: false };
  if (trimmed === 'none') return { ok: true, kinds: [] };
  if (trimmed === 'all') return { ok: true, kinds: ALL_KINDS };

  const parts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return { ok: false };

  const kinds: LlmOutputKind[] = [];
  for (const part of parts) {
    if (!ALL_KINDS.includes(part as LlmOutputKind)) {
      return { ok: false, invalid: part };
    }
    kinds.push(part as LlmOutputKind);
  }

  return { ok: true, kinds };
}

export function resolveLlmOutputPolicyFromCli(
  configPolicy: LlmOutputPolicy,
  cliValue?: string,
): { ok: true; policy: LlmOutputPolicy } | { ok: false; invalid?: string } {
  if (!cliValue) return { ok: true, policy: configPolicy };
  const parsed = parseLlmOutputKinds(cliValue);
  if (!parsed.ok) return { ok: false, invalid: parsed.invalid };
  return { ok: true, policy: resolveLlmOutputPolicy({ kinds: parsed.kinds }) };
}
