type BaseUrlInput = string | undefined | null;

const ENV_ORDER = ['SALMONLOOP_BASE_URL', 'S8P_BASE_URL'] as const;

function trimValue(value: BaseUrlInput): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveBaseUrl(override?: string): string | undefined {
  const candidate =
    trimValue(override) ||
    ENV_ORDER.map((name) => trimValue(process.env[name])).find((v) => Boolean(v));

  if (!candidate) return undefined;
  return normalizeUrl(candidate);
}
