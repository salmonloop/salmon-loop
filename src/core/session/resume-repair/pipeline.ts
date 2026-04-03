import { randomBytes } from 'crypto';

import type { CompressedSessionStore, SessionCompressor } from '../compression.js';

import { loadRawArchiveStateStage } from './stages/load-raw-archive-state.js';
import { reattachRuntimeStateStage } from './stages/reattach-runtime-state.js';
import { recoverOrphanedBranchesStage } from './stages/recover-orphaned-branches.js';
import { relinkBoundaryAndTailStage } from './stages/relink-boundary-and-tail.js';
import { replayStartupHooksStage } from './stages/replay-startup-hooks.js';
import { rescueStaleMetadataStage } from './stages/rescue-stale-metadata.js';
import type {
  ResumeRepairMutableState,
  ResumeRepairPipelineContext,
  ResumeRepairResult,
  ResumeRepairStartupHook,
} from './types.js';

interface CreateResumeRepairPipelineParams {
  compressedStore: Pick<CompressedSessionStore, 'loadCompressed'>;
  compressor: Pick<SessionCompressor, 'decompressToSession'>;
  repoPath: string;
  now?: () => number;
  nextId?: () => string;
  startupHooks?: ResumeRepairStartupHook[];
}

export interface ResumeRepairPipeline {
  run(input: { archiveId: string; filename: string }): Promise<ResumeRepairResult>;
}

export function createResumeRepairPipeline(
  params: CreateResumeRepairPipelineParams,
): ResumeRepairPipeline {
  const context: ResumeRepairPipelineContext = {
    repoPath: params.repoPath,
    now: params.now ?? (() => Date.now()),
    nextId: params.nextId ?? (() => randomBytes(6).toString('hex')),
    startupHooks: params.startupHooks ?? [],
  };

  return {
    async run(input): Promise<ResumeRepairResult> {
      const compressed = await params.compressedStore.loadCompressed(input.filename);
      if (!compressed) {
        return {
          warnings: [],
          repairActions: [],
          contractViolations: [
            {
              code: 'ARCHIVE_CORRUPTED',
              message: `Archive "${input.archiveId}" cannot be loaded.`,
            },
          ],
        };
      }

      const partial = await params.compressor.decompressToSession(compressed);
      const state: ResumeRepairMutableState = {
        archiveId: input.archiveId,
        filename: input.filename,
        compressed,
        partial,
        session: {
          meta: {
            id: '',
            name: '',
            repoPath: context.repoPath,
            createdAt: 0,
            updatedAt: 0,
            totalIterations: 0,
            successfulIterations: 0,
            totalTokens: { input: 0, output: 0 },
            snapshots: [],
          },
          messages: [],
          iterations: [],
        },
        warnings: [],
        repairActions: [],
        contractViolations: [],
      };

      const stages = [
        loadRawArchiveStateStage,
        rescueStaleMetadataStage,
        relinkBoundaryAndTailStage,
        recoverOrphanedBranchesStage,
        reattachRuntimeStateStage,
        replayStartupHooksStage,
      ];

      for (const stage of stages) {
        await stage(state, context);
        if (state.contractViolations.length > 0) {
          break;
        }
      }

      return {
        session: state.contractViolations.length > 0 ? undefined : state.session,
        replacementState: state.replacementState,
        warnings: state.warnings,
        repairActions: state.repairActions,
        contractViolations: state.contractViolations,
      };
    },
  };
}
