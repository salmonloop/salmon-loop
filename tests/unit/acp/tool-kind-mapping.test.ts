import { describe, expect, it } from 'bun:test';

import { mapToolKind } from '../../../src/core/protocols/acp/tool-kind-mapping.js';

describe('mapToolKind', () => {
  describe('intent-based mapping (highest priority)', () => {
    it('maps READ intent to read', () => {
      expect(mapToolKind('anything', { intent: 'READ' })).toBe('read');
    });

    it('maps LIST intent to read', () => {
      expect(mapToolKind('anything', { intent: 'LIST' })).toBe('read');
    });

    it('maps SEARCH intent to search', () => {
      expect(mapToolKind('anything', { intent: 'SEARCH' })).toBe('search');
    });

    it('maps WRITE intent to edit', () => {
      expect(mapToolKind('anything', { intent: 'WRITE' })).toBe('edit');
    });

    it('maps INFRA intent to execute', () => {
      expect(mapToolKind('anything', { intent: 'INFRA' })).toBe('execute');
    });

    it('maps AGENT intent to think', () => {
      expect(mapToolKind('anything', { intent: 'AGENT' })).toBe('think');
    });

    it('is case-insensitive for intent', () => {
      expect(mapToolKind('anything', { intent: 'read' })).toBe('read');
      expect(mapToolKind('anything', { intent: 'Write' })).toBe('edit');
    });
  });

  describe('side-effect-based mapping', () => {
    it('maps fs_read-only side effects to read', () => {
      expect(mapToolKind('unknown', { sideEffects: ['fs_read'] })).toBe('read');
    });

    it('maps fs_write side effect to edit', () => {
      expect(mapToolKind('unknown', { sideEffects: ['fs_read', 'fs_write'] })).toBe('edit');
    });

    it('maps fs_delete side effect to delete', () => {
      expect(mapToolKind('unknown', { sideEffects: ['fs_delete'] })).toBe('delete');
    });

    it('maps process side effect to execute', () => {
      expect(mapToolKind('unknown', { sideEffects: ['process'] })).toBe('execute');
    });

    it('intent takes priority over side effects', () => {
      expect(mapToolKind('unknown', { intent: 'READ', sideEffects: ['fs_write'] })).toBe('read');
    });
  });

  describe('name-based heuristics', () => {
    it('maps read-like names to read', () => {
      expect(mapToolKind('readFile')).toBe('read');
      expect(mapToolKind('getConfig')).toBe('read');
      expect(mapToolKind('viewDetails')).toBe('read');
      expect(mapToolKind('ls')).toBe('read');
      expect(mapToolKind('listItems')).toBe('read');
    });

    it('maps write-like names to edit', () => {
      expect(mapToolKind('writeFile')).toBe('edit');
      expect(mapToolKind('editConfig')).toBe('edit');
      expect(mapToolKind('applyPatch')).toBe('edit');
    });

    it('maps delete-like names to delete', () => {
      expect(mapToolKind('deleteFile')).toBe('delete');
      expect(mapToolKind('removeItem')).toBe('delete');
      expect(mapToolKind('rm')).toBe('delete');
    });

    it('maps move-like names to move', () => {
      expect(mapToolKind('moveFile')).toBe('move');
      expect(mapToolKind('renameItem')).toBe('move');
      expect(mapToolKind('mv')).toBe('move');
    });

    it('maps search-like names to search', () => {
      expect(mapToolKind('grepFiles')).toBe('search');
      expect(mapToolKind('searchCode')).toBe('search');
      expect(mapToolKind('findPattern')).toBe('search');
    });

    it('maps execute-like names to execute', () => {
      expect(mapToolKind('runTests')).toBe('execute');
      expect(mapToolKind('execCommand')).toBe('execute');
      expect(mapToolKind('spawnProcess')).toBe('execute');
    });

    it('maps think-like names to think', () => {
      expect(mapToolKind('planSteps')).toBe('think');
      expect(mapToolKind('thinkAbout')).toBe('think');
      expect(mapToolKind('reasonAbout')).toBe('think');
    });

    it('maps fetch-like names to fetch', () => {
      expect(mapToolKind('fetchUrl')).toBe('fetch');
      expect(mapToolKind('curlEndpoint')).toBe('fetch');
      expect(mapToolKind('httpRequest')).toBe('fetch');
    });

    it('maps mode/switch names to switch_mode', () => {
      expect(mapToolKind('switchMode')).toBe('switch_mode');
      expect(mapToolKind('changeMode')).toBe('switch_mode');
    });

    it('returns other for unrecognized names', () => {
      expect(mapToolKind('randomTool')).toBe('other');
      expect(mapToolKind('xyz123')).toBe('other');
    });
  });
});
