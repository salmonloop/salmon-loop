import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { Phase } from '../../../src/core/types/index.js';

describe('ToolAuditLogger', () => {
  it('uses summary as fallback when outputSummary is missing', () => {
    const audit = new ToolAuditLogger();

    audit.onEnd({
      id: 'call-1',
      toolName: 'test.echo',
      source: 'builtin',
      status: 'ok',
      summary: 'safe-summary',
      durationMs: 12,
      error: {
        code: 'NONE',
        message: '',
        retryable: false,
        failurePhase: Phase.CONTEXT,
      },
    });

    const logs = audit.getLogs();
    expect(logs[0]?.eventType).toBe('end');
    expect(logs[0]?.outputSummary).toBe('safe-summary');
  });
});
