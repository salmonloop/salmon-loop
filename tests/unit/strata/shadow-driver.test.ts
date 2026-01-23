/**
 * ShadowDriver Unit Tests
 *
 * Tests for ShadowDriver strategy selection, error classification,
 * and platform-specific copy implementations.
 */

import { describe, it, expect } from 'vitest';

import { isEnvironmentError } from '../../../src/core/strata/layers/shadow-driver/error-classifier.js';
import { determineStrategy } from '../../../src/core/strata/layers/shadow-driver/strategy.js';
import type { ShadowTask } from '../../../src/core/strata/types.js';

describe('ShadowDriver Strategy Selection', () => {
  it('defaults to ISOLATED without whitelist', () => {
    const task: ShadowTask = { command: 'npm test', mode: 'test' };
    const strategy = determineStrategy(task);
    expect(strategy).toBe('ISOLATED');
  });

  it('uses OPTIMIZED when whitelisted + test_readonly', () => {
    const task: ShadowTask = { command: 'eslint .', mode: 'test_readonly' };
    const whitelist = ['eslint'];
    const strategy = determineStrategy(task, whitelist);
    expect(strategy).toBe('OPTIMIZED');
  });

  it('forces ISOLATED on blacklist', () => {
    const task: ShadowTask = { command: 'npm install', mode: 'analysis' };
    const whitelist = ['npm'];
    const strategy = determineStrategy(task, whitelist);
    expect(strategy).toBe('ISOLATED');
  });

  it('respects forceIsolation flag', () => {
    const task: ShadowTask = { command: 'eslint .', mode: 'test_readonly', forceIsolation: true };
    const whitelist = ['eslint'];
    const strategy = determineStrategy(task, whitelist);
    expect(strategy).toBe('ISOLATED');
  });

  it('respects requiresWrite flag', () => {
    const task: ShadowTask = { command: 'eslint .', mode: 'test_readonly', requiresWrite: true };
    const whitelist = ['eslint'];
    const strategy = determineStrategy(task, whitelist);
    expect(strategy).toBe('ISOLATED');
  });
});

describe('Error Classification', () => {
  it('identifies MODULE_NOT_FOUND as environment error', () => {
    const error = new Error('MODULE_NOT_FOUND');
    expect(isEnvironmentError(error)).toBe(true);
  });

  it('identifies ENOENT for critical paths as environment error', () => {
    const error = new Error("ENOENT: no such file or directory, open 'node_modules/package.json'");
    expect(isEnvironmentError(error)).toBe(true);
  });

  it('identifies EACCES as environment error', () => {
    const error = new Error('EACCES: permission denied');
    expect(isEnvironmentError(error)).toBe(true);
  });

  it('identifies architecture mismatch as environment error', () => {
    const error = new Error('wrong ELF class');
    expect(isEnvironmentError(error)).toBe(true);
  });

  it('does not identify syntax error as environment error', () => {
    const error = new Error('SyntaxError: Unexpected token');
    expect(isEnvironmentError(error)).toBe(false);
  });

  it('does not identify assertion error as environment error', () => {
    const error = new Error('AssertionError: Expected true to be false');
    expect(isEnvironmentError(error)).toBe(false);
  });
});

describe('Command Normalization', () => {
  it('normalizes Windows paths', () => {
    const task: ShadowTask = { command: 'npm run test\\unit', mode: 'test_readonly' };
    const whitelist = ['npm run test/unit'];
    const strategy = determineStrategy(task, whitelist);
    expect(strategy).toBe('OPTIMIZED');
  });

  it('normalizes command case', () => {
    const task: ShadowTask = { command: 'NPM TEST', mode: 'test_readonly' };
    const whitelist = ['npm test'];
    const strategy = determineStrategy(task, whitelist);
    expect(strategy).toBe('OPTIMIZED');
  });
});
