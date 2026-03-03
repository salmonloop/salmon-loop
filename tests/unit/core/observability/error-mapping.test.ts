import { describe, expect, it } from 'bun:test';

import { REDACTED_ERROR_TOKEN } from '../../../../src/core/observability/error-envelope.js';
import { mapErrorForDisplay } from '../../../../src/core/observability/error-mapping.js';
import { text } from '../../../../src/locales/index.js';

describe('mapErrorForDisplay', () => {
  it('maps redacted token to localized message', () => {
    const result = mapErrorForDisplay({ message: REDACTED_ERROR_TOKEN });

    expect(result.message).toBe(text.errors.technicalDetailsHidden);
    expect(result.redacted).toBe(true);
  });

  it('maps LLM error codes to localized messages', () => {
    const result = mapErrorForDisplay({
      message: 'LLM request failed',
      code: 'LLM_HTTP_REQUEST_FAILED',
    });

    expect(result.message).toBe(text.llmErrors.httpRequestFailed);
    expect(result.code).toBe('LLM_HTTP_REQUEST_FAILED');
  });

  it('keeps original message when no mapping applies', () => {
    const result = mapErrorForDisplay({
      message: 'Something went wrong',
      code: 'UNKNOWN_ERROR',
    });

    expect(result.message).toBe('Something went wrong');
    expect(result.redacted).toBe(false);
  });
});
