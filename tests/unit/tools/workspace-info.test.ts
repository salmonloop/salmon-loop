import { describe, expect, it } from 'bun:test';

import {
  executeWorkspaceInfo,
  workspaceInfoSpec,
} from '../../../src/core/tools/builtin/workspace.js';
import { Phase } from '../../../src/core/types/index.js';

describe('workspace.info tool', () => {
  it('reports host-provided workspace capabilities to guide tool choice', async () => {
    const result = await executeWorkspaceInfo(
      {},
      {
        repoRoot: '/workspace/project',
        attemptId: 1,
        dryRun: true,
        phase: Phase.AUTOPILOT,
        workspaceCapabilities: {
          git: {
            available: true,
            insideWorkTree: false,
            reason: 'not a git work tree',
          },
          filesystem: {
            readable: true,
            writable: true,
          },
        },
      },
    );

    expect(result).toEqual({
      root: '/workspace/project',
      capabilities: {
        git: {
          available: true,
          insideWorkTree: false,
          reason: 'not a git work tree',
        },
        filesystem: {
          readable: true,
          writable: true,
        },
      },
      guidance: {
        useGitTools: false,
        useFilesystemReadTools: true,
        useFilesystemWriteTools: true,
      },
    });
  });

  it('distinguishes filesystem read and write guidance', async () => {
    const result = await executeWorkspaceInfo(
      {},
      {
        repoRoot: '/workspace/project',
        attemptId: 1,
        dryRun: true,
        phase: Phase.AUTOPILOT,
        workspaceCapabilities: {
          git: {
            available: true,
            insideWorkTree: true,
          },
          filesystem: {
            readable: true,
            writable: false,
            reason: 'read-only workspace',
          },
        },
      },
    );

    expect(result.guidance).toEqual({
      useGitTools: true,
      useFilesystemReadTools: true,
      useFilesystemWriteTools: false,
    });
  });

  it('is visible in phases where agents need to choose between git and filesystem tools', () => {
    expect(workspaceInfoSpec.name).toBe('workspace.info');
    expect(workspaceInfoSpec.allowedPhases).toEqual(
      expect.arrayContaining([Phase.PLAN, Phase.AUTOPILOT, Phase.VERIFY]),
    );
  });
});
