import { describe, expect, it } from 'bun:test';

import { getCommanderCode, getCommanderExitCode } from '../../../src/cli/commander-error-meta.js';

describe('commander-error-meta', () => {
  describe('getCommanderCode', () => {
    it('returns the code if err is an object with a code property', () => {
      expect(getCommanderCode({ code: 'COMMANDER_ERROR' })).toBe('COMMANDER_ERROR');
    });

    it('returns undefined if err is null', () => {
      expect(getCommanderCode(null)).toBeUndefined();
    });

    it('returns undefined if err is undefined', () => {
      expect(getCommanderCode(undefined)).toBeUndefined();
    });

    it('returns undefined if err is a primitive', () => {
      expect(getCommanderCode('error')).toBeUndefined();
      expect(getCommanderCode(123)).toBeUndefined();
      expect(getCommanderCode(true)).toBeUndefined();
    });

    it('returns undefined if err is an object without a code property', () => {
      expect(getCommanderCode({ message: 'error' })).toBeUndefined();
    });
  });

  describe('getCommanderExitCode', () => {
    it('returns the exitCode if err is an object with an exitCode property', () => {
      expect(getCommanderExitCode({ exitCode: 1 })).toBe(1);
    });

    it('returns undefined if err is null', () => {
      expect(getCommanderExitCode(null)).toBeUndefined();
    });

    it('returns undefined if err is undefined', () => {
      expect(getCommanderExitCode(undefined)).toBeUndefined();
    });

    it('returns undefined if err is a primitive', () => {
      expect(getCommanderExitCode('error')).toBeUndefined();
      expect(getCommanderExitCode(1)).toBeUndefined();
      expect(getCommanderExitCode(true)).toBeUndefined();
    });

    it('returns undefined if err is an object without an exitCode property', () => {
      expect(getCommanderExitCode({ message: 'error' })).toBeUndefined();
    });
  });
});
