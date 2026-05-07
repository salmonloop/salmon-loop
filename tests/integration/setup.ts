import { setLogger } from '../../src/core/observability/logger.js';

setLogger({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  silent: true,
} as any);
