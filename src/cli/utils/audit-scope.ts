export type CliAuditScope = 'repo' | 'user';

export function resolveAuditScope(params: {
  cliValue: unknown;
  configValue: CliAuditScope;
}): { ok: true; value: CliAuditScope } | { ok: false; invalid: string } {
  if (params.cliValue === undefined || params.cliValue === null || params.cliValue === '') {
    return { ok: true, value: params.configValue };
  }
  if (params.cliValue === 'repo' || params.cliValue === 'user') {
    return { ok: true, value: params.cliValue };
  }
  return { ok: false, invalid: String(params.cliValue) };
}
