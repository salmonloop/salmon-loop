import { z } from 'zod';

import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';

describe('ToolSanitizer', () => {
  const spec = {
    name: 'test.tool',
    defaultTimeoutMs: 1000,
    inputSchema: z.object({}),
    outputSchema: z.object({
      text: z.string(),
    }),
  } as any;

  it('redacts assignment style secrets in summary', () => {
    const sanitizer = new ToolSanitizer();
    const result = sanitizer.sanitizeOutput(spec, {
      text: 'apiKey=abc123 token: xyz secret="hello"',
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('apiKey=[REDACTED]');
    expect(result.summary).toContain('token: [REDACTED]');
    expect(result.summary).toContain('secret=[REDACTED]');
  });

  it('redacts bearer and sk keys in summary', () => {
    const sanitizer = new ToolSanitizer();
    const result = sanitizer.sanitizeOutput(spec, {
      text: 'Authorization: Bearer token-value sk-abcdefghijklmnopqrstuv123456',
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Authorization: Bearer [REDACTED]');
    expect(result.summary).not.toContain('sk-abcdefghijklmnopqrstuv123456');
  });
});
