export function reportCliCrash(err: unknown): void {
  import('../core/observability/logger.js').then(({ logger }) => {
    logger.error('CLI execution crashed', err, true);
  });
}
