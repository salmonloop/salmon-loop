import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { NodePathAdapter } from '../../../../../src/core/adapters/path/path-adapter.js';

describe('NodePathAdapter', () => {
  const adapter = new NodePathAdapter();

  describe('join', () => {
    it('should join path segments correctly', () => {
      expect(adapter.join('a', 'b', 'c')).toBe(path.join('a', 'b', 'c'));
      expect(adapter.join('/a', 'b', 'c')).toBe(path.join('/a', 'b', 'c'));
      expect(adapter.join('a', '..', 'c')).toBe(path.join('a', '..', 'c'));
      expect(adapter.join()).toBe(path.join());
    });
  });

  describe('resolve', () => {
    it('should resolve path segments correctly', () => {
      expect(adapter.resolve('a', 'b', 'c')).toBe(path.resolve('a', 'b', 'c'));
      expect(adapter.resolve('/a', 'b', 'c')).toBe(path.resolve('/a', 'b', 'c'));
      expect(adapter.resolve('a', '..', 'c')).toBe(path.resolve('a', '..', 'c'));
      expect(adapter.resolve()).toBe(path.resolve());
    });
  });

  describe('dirname', () => {
    it('should return the directory name of a path', () => {
      expect(adapter.dirname('/a/b/c')).toBe(path.dirname('/a/b/c'));
      expect(adapter.dirname('a/b/c')).toBe(path.dirname('a/b/c'));
      expect(adapter.dirname('a')).toBe(path.dirname('a'));
      expect(adapter.dirname('')).toBe(path.dirname(''));
    });
  });

  describe('basename', () => {
    it('should return the base name of a path', () => {
      expect(adapter.basename('/a/b/c.txt')).toBe(path.basename('/a/b/c.txt'));
      expect(adapter.basename('a/b/c')).toBe(path.basename('a/b/c'));
      expect(adapter.basename('a')).toBe(path.basename('a'));
      expect(adapter.basename('')).toBe(path.basename(''));
    });
  });

  describe('relative', () => {
    it('should return the relative path from one path to another', () => {
      expect(adapter.relative('/a/b/c', '/a/b/d')).toBe(path.relative('/a/b/c', '/a/b/d'));
      expect(adapter.relative('/a/b', '/c/d')).toBe(path.relative('/a/b', '/c/d'));
      expect(adapter.relative('a', 'b')).toBe(path.relative('a', 'b'));
    });
  });

  describe('isAbsolute', () => {
    it('should determine if a path is absolute', () => {
      expect(adapter.isAbsolute('/a/b/c')).toBe(path.isAbsolute('/a/b/c'));
      expect(adapter.isAbsolute('a/b/c')).toBe(path.isAbsolute('a/b/c'));
      expect(adapter.isAbsolute('')).toBe(path.isAbsolute(''));
    });
  });
});
