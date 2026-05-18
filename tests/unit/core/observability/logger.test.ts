import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../../src/core/observability/audit-trail.js';
import { createLogger, SilentReporter } from '../../../../src/core/observability/logger.js';

describe('Logger audit behavior', () => {
  beforeEach(() => {
    clearAuditTrail();
  });

  it('records audit events without emitting visible reporter lines', () => {
    const reporter = {
      log: mock(),
    };
    const logger = createLogger();
    logger.setReporter(reporter);

    logger.audit('code.search.backend', { backendId: 'rg' }, { source: 'tool', severity: 'low' });

    expect(getAuditTrail().some((event) => event.action === 'code.search.backend')).toBe(true);
    expect(reporter.log).not.toHaveBeenCalled();
  });

  it('provides a silent reporter for machine-readable protocol modes', () => {
    const reporter = new SilentReporter();

    expect(() => {
      reporter.log('error', 'Technical details were hidden for safety.');
      reporter.log('info', 'status update');
      reporter.clear();
    }).not.toThrow();
  });
});
