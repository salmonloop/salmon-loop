export function getCommanderCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

export function getCommanderExitCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'exitCode' in err) {
    return (err as { exitCode?: number }).exitCode;
  }
  return undefined;
}
