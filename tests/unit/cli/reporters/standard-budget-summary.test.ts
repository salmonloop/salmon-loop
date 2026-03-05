import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { StandardReporter } from '../../../../src/cli/reporters/standard.js';
import { getLogger } from '../../../../src/core/observability/logger.js';

describe('StandardReporter budget summary', () => {
  afterEach(() => {
    mock.restore();
  });

  it('prints run-end budget summary when present', () => {
    const logger = getLogger();
    const infoSpy = spyOn(logger, 'info').mockImplementation(() => {});
    const successSpy = spyOn(logger, 'success').mockImplementation(() => {});
    const logSpy = spyOn(logger, 'log').mockImplementation(() => {});

    const reporter = new StandardReporter(false);
    reporter.onFinish({
      success: true,
      reason: 'ok',
      reasonCode: 'SUCCESS',
      attempts: 2,
      logs: [],
      budgetSummary: {
        attemptCount: 2,
        adjustmentCount: 1,
        alertCount: 1,
        criticalDropCount: 0,
        avgUtilization: 0.75,
        truncationRate: 0.5,
        successRate: 0.5,
      },
    });

    expect(successSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(infoSpy.mock.calls.some((call) => String(call[0]).includes('Budget summary'))).toBe(
      true,
    );
  });
});
