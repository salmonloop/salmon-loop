import { z } from 'zod';

import { Phase } from '../../types/runtime.js';
import { detectWorkspaceCapabilities } from '../../workspace/capabilities.js';
import type { ToolSpec, ToolRuntimeCtx } from '../types.js';

const WorkspaceCapabilitiesOutputSchema = z.object({
  root: z.string(),
  capabilities: z.object({
    git: z.object({
      available: z.boolean(),
      insideWorkTree: z.boolean(),
      head: z.string().optional(),
      reason: z.string().optional(),
    }),
    filesystem: z.object({
      readable: z.boolean(),
      writable: z.boolean(),
      reason: z.string().optional(),
    }),
  }),
  guidance: z.object({
    useGitTools: z.boolean(),
    useFilesystemReadTools: z.boolean(),
    useFilesystemWriteTools: z.boolean(),
  }),
});

export const workspaceInfoSpec: Omit<ToolSpec, 'executor'> = {
  name: 'workspace.info',
  source: 'builtin',
  intent: 'READ',
  description:
    'Report the current workspace root and available capabilities, including whether git tools are usable.',
  riskLevel: 'low',
  sideEffects: ['none'],
  concurrency: 'parallel_ok',
  inputSchema: z.object({}),
  outputSchema: WorkspaceCapabilitiesOutputSchema,
  allowedPhases: [
    Phase.SLASH,
    Phase.CONTEXT,
    Phase.EXPLORE,
    Phase.PLAN,
    Phase.AUTOPILOT,
    Phase.PATCH,
    Phase.VERIFY,
    Phase.SHRINK,
  ],
  examples: [
    {
      description: 'Check whether git tools are available before calling git.status',
      input: {},
      output: {
        root: '/workspace/project',
        capabilities: {
          git: { available: true, insideWorkTree: true, head: '<commit>' },
          filesystem: { readable: true, writable: true },
        },
        guidance: {
          useGitTools: true,
          useFilesystemReadTools: true,
          useFilesystemWriteTools: true,
        },
      },
    },
  ],
};

export async function executeWorkspaceInfo(
  _input: z.infer<typeof workspaceInfoSpec.inputSchema>,
  ctx: ToolRuntimeCtx,
): Promise<z.infer<typeof WorkspaceCapabilitiesOutputSchema>> {
  const capabilities =
    ctx.workspaceCapabilities ?? (await detectWorkspaceCapabilities(ctx.repoRoot));
  return {
    root: ctx.repoRoot,
    capabilities,
    guidance: {
      useGitTools: capabilities.git.available && capabilities.git.insideWorkTree,
      useFilesystemReadTools: capabilities.filesystem.readable,
      useFilesystemWriteTools: capabilities.filesystem.writable,
    },
  };
}
