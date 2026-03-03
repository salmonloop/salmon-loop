import { describe, expect, it } from 'bun:test';

import { displayReport } from '../../../../../src/core/grizzco/steps/display-report.js';
import { text } from '../../../../../src/locales/index.js';

describe('displayReport', () => {
  it('throws when report payload is missing', async () => {
    const ctx: any = {
      options: { llmOutput: { kinds: [] } },
      emit: () => {},
    };

    try {
      await displayReport(ctx);
      throw new Error('Expected displayReport to throw');
    } catch (error: any) {
      expect(error?.message).toBe(
        'Report context missing: expected report.kind to be set before REPORT step.',
      );
      expect(error?.name).toBe('ReportContextMissingError');
      expect(error?.code).toBe('REPORT_CONTEXT_MISSING');
    }
  });

  it('renders research findings with research header', async () => {
    const messages: string[] = [];
    const ctx: any = {
      options: { llmOutput: { kinds: [] } },
      researchFindings: [{ summary: 'Finding A', confidence: 0.7, uncertainty: 'sample' }],
      researchText: 'Summary text',
      report: {
        kind: 'research',
        findings: [{ summary: 'Finding A', confidence: 0.7, uncertainty: 'sample' }],
        summary: 'Summary text',
        timestamp: Date.now(),
      },
      emit: (event: any) => {
        if (event?.message) messages.push(event.message);
      },
    };

    await displayReport(ctx);

    expect(messages[0]).toBe(text.grizzco.research.header);
    expect(messages.join('\n')).toContain('Finding 1: Finding A');
  });
});
