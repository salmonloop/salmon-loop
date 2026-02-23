import { describe, expect, it } from 'vitest';

import { resolveAstValidationStrictness } from '../../../../../src/core/grizzco/validation/ast-validation-policy.js';

describe('resolveAstValidationStrictness', () => {
  it('defaults to strict in debug mode', () => {
    const strictness = resolveAstValidationStrictness({
      mode: 'debug',
      options: {},
    });

    expect(strictness).toBe('strict');
  });

  it('defaults to lenient in patch mode', () => {
    const strictness = resolveAstValidationStrictness({
      mode: 'patch',
      options: {},
    });

    expect(strictness).toBe('lenient');
  });

  it('defaults to lenient in review mode', () => {
    const strictness = resolveAstValidationStrictness({
      mode: 'review',
      options: {},
    });

    expect(strictness).toBe('lenient');
  });

  it('prefers explicit strictness from options', () => {
    const strictness = resolveAstValidationStrictness({
      mode: 'patch',
      options: { astValidation: { strictness: 'strict' } },
    });

    expect(strictness).toBe('strict');
  });

  it('prefers explicit lenient strictness from options', () => {
    const strictness = resolveAstValidationStrictness({
      mode: 'debug',
      options: { astValidation: { strictness: 'lenient' } },
    });

    expect(strictness).toBe('lenient');
  });
});
