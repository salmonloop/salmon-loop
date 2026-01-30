import path from 'path';

import { normalizePath } from '../../path.js';

export interface ResolveImportOptions {
  currentFile: string; // repo-relative
  specifier: string;
}

const EXT_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const INDEX_CANDIDATES = [
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
  '/index.cjs',
] as const;

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
  for (const ext of EXT_CANDIDATES) {
    out.push(`${normalizedJoined}${ext}`);
  }
  for (const idx of INDEX_CANDIDATES) {
    out.push(`${normalizedJoined}${idx}`);
  }

  return out;
}
