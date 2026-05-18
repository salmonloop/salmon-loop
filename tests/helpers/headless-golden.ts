import { readFileSync } from 'node:fs';

export function readJsonFixture<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function looksLikeIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function normalizeString(value: string, repoPath: string): string {
  if (value === repoPath) return '<repo>';
  if (value.includes(repoPath)) return value.split(repoPath).join('<repo>');
  if (looksLikeIsoTimestamp(value)) return '<ts>';
  if (value.startsWith('resp_')) return 'resp_<id>';
  if (value.startsWith('item_')) return 'item_<id>';
  if (value.startsWith('item-')) return 'item-<id>';
  return value;
}

function normalizeUnknown(value: unknown, repoPath: string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeUnknown(v, repoPath));
  if (typeof value === 'string') return normalizeString(value, repoPath);
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'uuid') {
      out[key] = '<uuid>';
      continue;
    }
    if (key === 'timestamp') {
      out[key] = '<ts>';
      continue;
    }
    if (key.endsWith('_at') && typeof raw === 'number') {
      out[key] = 0;
      continue;
    }
    if (key === 'created_at' && typeof raw === 'number') {
      out[key] = 0;
      continue;
    }
    if (key === 'completed_at' && typeof raw === 'number') {
      out[key] = 0;
      continue;
    }
    if (key === 'output_text' && typeof raw === 'string') {
      out[key] = '<text>';
      continue;
    }
    if (key === 'text' && typeof raw === 'string') {
      out[key] = '<text>';
      continue;
    }
    if (key === 'message') {
      if (typeof raw === 'string' || isRecord(raw)) {
        out[key] = '<msg>';
      } else {
        out[key] = raw;
      }
      continue;
    }
    if (
      key === 'id' &&
      typeof raw === 'string' &&
      (raw.startsWith('resp_') || raw.startsWith('item_'))
    ) {
      out[key] = normalizeString(raw, repoPath);
      continue;
    }

    out[key] = normalizeUnknown(raw, repoPath);
  }
  return out;
}

export function normalizeHeadlessIntegrationLines(params: {
  lines: unknown[];
  repoPath: string;
}): unknown[] {
  return params.lines.map((l) => normalizeUnknown(l, params.repoPath));
}

type NativeLifecycleType = 'start' | 'result' | 'error' | 'end';

interface NativeLifecycleEvent {
  type: NativeLifecycleType;
  command?: string;
  repo_path?: string;
  instruction?: string;
  success?: boolean;
  exit_code?: number;
  error?: unknown;
  timestamp?: string;
}

interface NativeLifecycleLine {
  uuid?: string;
  session_id?: string;
  protocol_version?: number;
  event_seq?: number;
  event?: unknown;
}

interface AnthropicLifecycleLine {
  type: NativeLifecycleType;
  session_id?: string;
  command?: string;
  repo_path?: string;
  instruction?: string;
  success?: boolean;
  exit_code?: number;
  error?: unknown;
}

interface OpenAiLifecycleLine {
  type: string;
  sequence_number?: number;
  response?: Record<string, unknown>;
  code?: number;
}

function isNativeLifecycleLine(value: unknown): value is NativeLifecycleLine & {
  event: NativeLifecycleEvent;
} {
  if (!isRecord(value)) return false;
  const event = value.event;
  return (
    isRecord(event) &&
    typeof event.type === 'string' &&
    ['start', 'result', 'error', 'end'].includes(event.type)
  );
}

function isAnthropicLifecycleLine(value: unknown): value is AnthropicLifecycleLine {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    ['start', 'result', 'error', 'end'].includes(value.type)
  );
}

const OPENAI_TYPES = new Set([
  'response.created',
  'response.in_progress',
  'response.completed',
  'response.failed',
  'error',
]);

function isOpenAiLifecycleLine(value: unknown): value is OpenAiLifecycleLine {
  return isRecord(value) && typeof value.type === 'string' && OPENAI_TYPES.has(value.type);
}

export function pickNativeLifecycleLines(lines: unknown[]): Array<{
  uuid?: string;
  session_id?: string;
  protocol_version?: number;
  event_seq?: number;
  event: NativeLifecycleEvent;
}> {
  return lines.filter(isNativeLifecycleLine).map((line, index) => {
    const event: NativeLifecycleEvent = {
      type: line.event.type,
    };

    if (line.event.type === 'start') {
      event.command = line.event.command;
      event.repo_path = line.event.repo_path;
      event.instruction = line.event.instruction;
    }

    if (line.event.type === 'result' || line.event.type === 'end') {
      event.success = line.event.success;
      event.exit_code = line.event.exit_code;
    }

    if (line.event.type === 'error') {
      event.error = line.event.error;
    }

    if (line.event.timestamp) {
      event.timestamp = line.event.timestamp;
    }

    return {
      uuid: line.uuid,
      session_id: line.session_id,
      protocol_version: line.protocol_version,
      event_seq: index,
      event,
    };
  });
}

export function pickAnthropicLifecycleLines(lines: unknown[]): Array<{
  type: NativeLifecycleType;
  session_id?: string;
  command?: string;
  repo_path?: string;
  instruction?: string;
  success?: boolean;
  exit_code?: number;
  error?: unknown;
}> {
  return lines.filter(isAnthropicLifecycleLine).map((entry) => ({
    type: entry.type,
    session_id: entry.session_id,
    ...(entry.type === 'start'
      ? {
          command: entry.command,
          repo_path: entry.repo_path,
          instruction: entry.instruction,
        }
      : {}),
    ...(entry.type === 'result' || entry.type === 'end'
      ? { success: entry.success, exit_code: entry.exit_code }
      : {}),
    ...(entry.type === 'error' ? { error: entry.error } : {}),
  }));
}

export function pickOpenAiLifecycleLines(lines: unknown[]): Array<{
  type: string;
  sequence_number: number;
  response?: {
    object?: unknown;
    status?: unknown;
  };
  code?: number;
}> {
  const picked = lines.filter(isOpenAiLifecycleLine);

  return picked.map((entry, index) => {
    if (entry.type === 'error') {
      return {
        type: entry.type,
        sequence_number: index,
        code: entry.code,
      };
    }

    const response = isRecord(entry.response)
      ? {
          object: entry.response.object,
          status: entry.response.status,
        }
      : undefined;

    return {
      type: entry.type,
      sequence_number: index,
      response,
    };
  });
}
