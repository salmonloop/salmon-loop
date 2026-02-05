import path from 'path';

import { ToolRuntimeCtx } from '../types.js';

import { ResourceKey } from './resources.js';

const toPosix = (value: string) => value.replace(/\\/g, '/');

const normalizePrefix = (value: string): string => {
  const trimmed = toPosix(value).replace(/^\/+/, '');
  if (!trimmed || trimmed === '.') return '';

  if (trimmed.endsWith('/')) {
    return trimmed;
  }

  const dir = path.posix.dirname(trimmed);
  if (dir === '.' || dir === '') return '';

  return dir.endsWith('/') ? dir : `${dir}/`;
};

export const repoResource = (ctx: ToolRuntimeCtx): ResourceKey => ({
  kind: 'repo',
  id: ctx.repoRoot,
});

export const processResource = (ctx: ToolRuntimeCtx): ResourceKey => ({
  kind: 'process',
  scope: 'repo',
  repoId: ctx.repoRoot,
});

export const pathPrefixResource = (ctx: ToolRuntimeCtx, relativePath: string): ResourceKey => {
  const prefix = normalizePrefix(relativePath);
  if (!prefix) {
    return repoResource(ctx);
  }

  return {
    kind: 'pathPrefix',
    repoId: ctx.repoRoot,
    prefix,
  };
};
