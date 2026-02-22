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

export function pickNativeLifecycleLines(lines: any[]): any[] {
  return lines
    .filter((l) => isRecord(l) && isRecord(l.event) && typeof l.event.type === 'string')
    .filter((l) => ['start', 'result', 'error', 'end'].includes(String((l as any).event.type)))
    .map((l) => {
      const event = (l as any).event as any;
      return {
        uuid: (l as any).uuid,
        session_id: (l as any).session_id,
        event: {
          type: event.type,
          ...(event.type === 'start'
            ? {
                command: event.command,
                repo_path: event.repo_path,
                instruction: event.instruction,
              }
            : {}),
          ...(event.type === 'result' || event.type === 'end'
            ? { success: event.success, exit_code: event.exit_code }
            : {}),
          ...(event.type === 'error' ? { error: event.error } : {}),
          ...(event.timestamp ? { timestamp: event.timestamp } : {}),
        },
      };
    });
}

export function pickAnthropicLifecycleLines(lines: any[]): any[] {
  return lines
    .filter((l) => isRecord(l) && typeof (l as any).type === 'string')
    .filter((l) => ['start', 'result', 'error', 'end'].includes(String((l as any).type)))
    .map((l) => {
      return {
        type: (l as any).type,
        session_id: (l as any).session_id,
        ...(l.type === 'start'
          ? {
              command: (l as any).command,
              repo_path: (l as any).repo_path,
              instruction: (l as any).instruction,
            }
          : {}),
        ...(l.type === 'result' || l.type === 'end'
          ? { success: (l as any).success, exit_code: (l as any).exit_code }
          : {}),
        ...(l.type === 'error' ? { error: (l as any).error } : {}),
      };
    });
}

export function pickOpenAiLifecycleLines(lines: any[]): any[] {
  const picked = lines
    .filter((l) => isRecord(l) && typeof (l as any).type === 'string')
    .filter((l) =>
      [
        'response.created',
        'response.in_progress',
        'response.completed',
        'response.failed',
        'error',
      ].includes(String((l as any).type)),
    )
    .map((l) => {
      if ((l as any).type === 'error') {
        return {
          type: (l as any).type,
          sequence_number: (l as any).sequence_number,
          code: (l as any).code,
        };
      }

      const response = isRecord((l as any).response) ? (l as any).response : {};
      return {
        type: (l as any).type,
        sequence_number: (l as any).sequence_number,
        response: {
          object: (response as any).object,
          status: (response as any).status,
        },
      };
    });

  return picked.map((l, i) => ({ ...l, sequence_number: i }));
}
