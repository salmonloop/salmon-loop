const DEFAULT_REDACTION_MARK = '[REDACTED]';

export interface RedactionOptions {
  mark?: string;
  maxDepth?: number;
}

export interface RedactionConfig {
  enabled: boolean;
  mark: string;
  maxDepth: number;
}

const DEFAULT_LIMITS = {
  maxDepth: 6,
} as const;

const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  enabled: true,
  mark: DEFAULT_REDACTION_MARK,
  maxDepth: DEFAULT_LIMITS.maxDepth,
};

let currentConfig: RedactionConfig = { ...DEFAULT_REDACTION_CONFIG };
let redactionCount = 0;

export function setRedactionConfig(options?: Partial<RedactionConfig>): RedactionConfig {
  if (!options) {
    currentConfig = { ...DEFAULT_REDACTION_CONFIG };
    return currentConfig;
  }
  currentConfig = {
    enabled: options.enabled ?? currentConfig.enabled,
    mark: options.mark ?? currentConfig.mark,
    maxDepth: options.maxDepth ?? currentConfig.maxDepth,
  };
  return currentConfig;
}

export function getRedactionConfig(): RedactionConfig {
  return { ...currentConfig };
}

export function drainRedactionMetrics(): { count: number } {
  const count = redactionCount;
  redactionCount = 0;
  return { count };
}

type RedactionResult<T> = { value: T; redacted: boolean };

const SIMPLE_PATTERNS: Array<RegExp> = [
  /sk-[A-Za-z0-9]{10,}/g,
  /Bearer\s+[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
];

const KV_PATTERN = /(\b(?:token|secret|password|api[_-]?key)\b\s*[:=]\s*)([^\s,'"]+)/gi;
const QUERY_PATTERN = /([?&](?:token|secret|password|api_key|apikey)=)([^&\s]+)/gi;

export function redactSensitiveString(
  input: string,
  options: RedactionOptions = {},
): RedactionResult<string> {
  if (!currentConfig.enabled) {
    return { value: input, redacted: false };
  }
  const mark = options.mark ?? currentConfig.mark;
  let output = input;
  let redacted = false;

  output = output.replace(KV_PATTERN, (_match, prefix: string, _value: string) => {
    redacted = true;
    return `${prefix}${mark}`;
  });

  output = output.replace(QUERY_PATTERN, (_match, prefix: string, _value: string) => {
    redacted = true;
    return `${prefix}${mark}`;
  });

  for (const pattern of SIMPLE_PATTERNS) {
    const next = output.replace(pattern, mark);
    if (next !== output) {
      redacted = true;
      output = next;
    }
    pattern.lastIndex = 0;
  }

  if (redacted) {
    redactionCount += 1;
  }

  return { value: output, redacted };
}

export function redactSensitiveValue<T>(
  value: T,
  options: RedactionOptions = {},
  state: { depth: number; seen: WeakSet<object> } = { depth: 0, seen: new WeakSet<object>() },
): RedactionResult<T> {
  if (!currentConfig.enabled) {
    return { value, redacted: false };
  }
  const maxDepth = options.maxDepth ?? currentConfig.maxDepth;
  if (value === null || value === undefined) return { value, redacted: false };

  if (typeof value === 'string') {
    const result = redactSensitiveString(value, options);
    return { value: result.value as any, redacted: result.redacted };
  }

  if (typeof value !== 'object') {
    return { value, redacted: false };
  }

  if (state.depth >= maxDepth) {
    return { value, redacted: false };
  }

  const obj = value as Record<string, unknown>;
  if (state.seen.has(obj)) return { value, redacted: false };
  state.seen.add(obj);

  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const result = redactSensitiveValue(item as any, options, {
        depth: state.depth + 1,
        seen: state.seen,
      });
      redacted = redacted || result.redacted;
      return result.value;
    });
    return { value: next as any, redacted };
  }

  let redacted = false;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const result = redactSensitiveValue(val as any, options, {
      depth: state.depth + 1,
      seen: state.seen,
    });
    redacted = redacted || result.redacted;
    out[key] = result.value;
  }

  if (redacted) {
    redactionCount += 1;
  }

  return { value: out as any, redacted };
}
