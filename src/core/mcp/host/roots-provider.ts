import { pathToFileURL } from 'node:url';

import type { FlowMode } from '../../types/runtime.js';
import type { McpRootsMode } from '../types.js';

export type McpRootsExposureMode = 'none' | 'read-only' | 'write';

export interface McpRoot {
  uri: string;
  name: string;
  _meta?: Record<string, unknown>;
}

export interface McpRootsProviderOptions {
  repoRoot: string;
  worktreeRoot?: string;
  flowMode?: FlowMode;
  mode?: McpRootsExposureMode;
}

export interface McpListRootsInput {
  mode: McpRootsMode;
  repoRoot: string;
  worktreeRoot?: string;
  flowMode?: FlowMode;
}

export interface McpListRootsResult {
  roots: McpRoot[];
  _meta: {
    audit: {
      event: 'mcp.roots.list';
      mode: McpRootsExposureMode;
      flowMode?: FlowMode;
      exposed: Array<'repoRoot' | 'worktreeRoot'>;
      deniedReason?: 'none_mode' | 'missing_worktree_root';
    };
  };
}

const WRITE_MODES = new Set<FlowMode>(['patch', 'debug', 'autopilot']);

function rootName(kind: 'repoRoot' | 'worktreeRoot', flowMode?: FlowMode): string {
  if (kind === 'worktreeRoot') return flowMode ? `${flowMode}-worktree` : 'worktree';
  return 'repository';
}

function toRoot(path: string, kind: 'repoRoot' | 'worktreeRoot', flowMode?: FlowMode): McpRoot {
  return {
    uri: pathToFileURL(path).toString(),
    name: rootName(kind, flowMode),
    _meta: {
      kind,
      flowMode,
    },
  };
}

function mapMode(input: McpListRootsInput | McpRootsProviderOptions): McpRootsExposureMode {
  if (input.mode === 'none') return 'none';
  if (input.mode === 'worktree') return 'write';
  if (input.mode === 'repo') {
    return WRITE_MODES.has(input.flowMode ?? 'patch') ? 'write' : 'read-only';
  }
  return input.mode ?? 'none';
}

function buildResult(input: McpRootsProviderOptions | McpListRootsInput): McpListRootsResult {
  const mode = mapMode(input);
  const audit: McpListRootsResult['_meta']['audit'] = {
    event: 'mcp.roots.list',
    mode,
    flowMode: input.flowMode,
    exposed: [],
  };

  if (mode === 'none') {
    audit.deniedReason = 'none_mode';
    return { roots: [], _meta: { audit } };
  }

  if (mode === 'read-only') {
    audit.exposed.push('repoRoot');
    return {
      roots: [toRoot(input.repoRoot, 'repoRoot', input.flowMode)],
      _meta: { audit },
    };
  }

  if (!input.worktreeRoot) {
    audit.deniedReason = 'missing_worktree_root';
    return { roots: [], _meta: { audit } };
  }

  audit.exposed.push('worktreeRoot');
  return {
    roots: [toRoot(input.worktreeRoot, 'worktreeRoot', input.flowMode)],
    _meta: { audit },
  };
}

export class McpRootsProvider {
  constructor(private readonly options?: McpRootsProviderOptions) {}

  listRoots(): McpListRootsResult;
  listRoots(input: McpListRootsInput): McpRoot[];
  listRoots(input?: McpListRootsInput): McpListRootsResult | McpRoot[] {
    if (input) return buildResult(input).roots;
    if (!this.options) return buildResult({ repoRoot: '', mode: 'none' });
    return buildResult(this.options);
  }
}
