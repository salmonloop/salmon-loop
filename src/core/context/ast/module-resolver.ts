import path from 'path';

import { pluginRegistry } from '../../plugin/registry.js';
import { normalizePath } from '../../utils/path.js';

export interface ResolveImportOptions {
  currentFile: string; // repo-relative
  specifier: string;
}

// Dynamic extension candidates from registered plugins
function getExtensionCandidates(): string[] {
  const allPlugins = pluginRegistry.getAll();
  const extensions = new Set<string>();
  for (const plugin of allPlugins) {
    for (const ext of plugin.meta.extensions) {
      const normalized = ext.startsWith('.') ? ext : `.${ext}`;
      extensions.add(normalized);
    }
  }
  // Always include .json for config files
  extensions.add('.json');
  return Array.from(extensions);
}

// Dynamic index candidates from registered plugins
function getIndexCandidates(): string[] {
  const allPlugins = pluginRegistry.getAll();
  const indices = new Set<string>();
  for (const plugin of allPlugins) {
    for (const ext of plugin.meta.extensions) {
      const normalized = ext.startsWith('.') ? ext : `.${ext}`;
      indices.add(`/index${normalized}`);
    }
  }
  return Array.from(indices);
}

export function resolveImportCandidates(opts: ResolveImportOptions): string[] {
  const spec = opts.specifier.trim();
  if (!spec.startsWith('.')) return [];

  const baseDir = normalizePath(path.posix.dirname(normalizePath(opts.currentFile)));
  const joined = normalizePath(path.posix.join(baseDir, spec));

  // Prevent escaping the repo root.
  if (joined.startsWith('..')) return [];

  const normalizedJoined = joined.replace(/^(\.\/|\/)+/, '');
  if (!normalizedJoined) return [];

  const hasExt = path.posix.extname(normalizedJoined) !== '';
  if (hasExt) {
    const out = [normalizedJoined];
    if (normalizedJoined.endsWith('.js')) out.push(normalizedJoined.replace(/\.js$/, '.ts'));
    if (normalizedJoined.endsWith('.jsx')) out.push(normalizedJoined.replace(/\.jsx$/, '.tsx'));
    return out;
  }

  const out: string[] = [];
  const extCandidates = getExtensionCandidates();
  const idxCandidates = getIndexCandidates();

  for (const ext of extCandidates) {
    out.push(`${normalizedJoined}${ext}`);
  }
  for (const idx of idxCandidates) {
    out.push(`${normalizedJoined}${idx}`);
  }

  return out;
}
