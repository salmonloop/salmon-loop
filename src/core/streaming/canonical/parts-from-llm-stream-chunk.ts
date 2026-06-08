import type { LLMStreamChunk } from '../../types/index.js';
import { isRecord, getString, getRecord } from '../../utils/serialize.js';

import type { CanonicalStreamPart } from './canonical-responses-event-emitter.js';

/**
 * Best-effort conversion from our provider-agnostic `LLMStreamChunk` into
 * provider-agnostic canonical stream parts.
 *
 * Notes:
 * - This function intentionally does not sanitize text/tool args. Sanitization
 *   belongs to the caller (e.g., `output-policy` / redaction policies).
 * - Tool call arguments are surfaced as *done* parts (not deltas) because our
 *   current `LLMStreamChunk` contract does not carry argument deltas.
 */
export function mapLlmStreamChunkToCanonicalStreamParts(params: {
  streamId: string;
  chunk: LLMStreamChunk;
}): CanonicalStreamPart[] {
  const out: CanonicalStreamPart[] = [];
  const { streamId, chunk } = params;

  if (typeof chunk.contentDelta === 'string' && chunk.contentDelta) {
    out.push({ type: 'output_text.delta', streamId, delta: chunk.contentDelta });
  }

  if (Array.isArray(chunk.tool_calls)) {
    for (const callUnknown of chunk.tool_calls) {
      if (!isRecord(callUnknown)) continue;
      const callId = getString(callUnknown, 'id');
      const fn = getRecord(callUnknown, 'function');
      const toolName = fn ? getString(fn, 'name') : null;
      const args = fn ? getString(fn, 'arguments') : null;
      if (!callId) continue;
      if (!toolName) continue;

      out.push({ type: 'function_call.start', streamId, callId, name: toolName });
      if (args !== null) {
        out.push({
          type: 'function_call_arguments.done',
          streamId,
          callId,
          name: toolName ?? undefined,
          arguments: args,
        });
      }
    }
  }

  return out;
}
