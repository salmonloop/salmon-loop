type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
};

export async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: WaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = await check();
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const suffix = options.description ? ` (${options.description})` : '';
  throw new Error(`Timed out waiting for condition${suffix}`);
}

export async function waitForPath(
  targetPath: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const { stat } = await import('fs/promises');
  await waitForCondition(
    async () => {
      try {
        await stat(targetPath);
        return true;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: options?.timeoutMs,
      intervalMs: options?.intervalMs,
      description: `path ${targetPath}`,
    },
  );
}
