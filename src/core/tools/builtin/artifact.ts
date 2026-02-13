import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { ArtifactStore } from '../../sub-agent/artifacts/store.js';
import { Phase } from '../../types/index.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

export const artifactReadSpec: Omit<ToolSpec, 'executor'> = {
  name: 'artifact.read',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.artifactReadDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  inputSchema: z.object({
    handle: z.string().describe('Artifact handle returned by salmonloop (s8p namespace)'),
  }),
  outputSchema: z.object({
    content: z.string(),
    size: z.number(),
  }),
  allowedPhases: [Phase.CONTEXT, Phase.PLAN, Phase.PATCH, Phase.SHRINK],
};

export async function executeArtifactRead(
  input: z.infer<typeof artifactReadSpec.inputSchema>,
  _ctx: ToolRuntimeCtx,
) {
  const result = await ArtifactStore.readText(input.handle);
  if (!result.ok) {
    throw new Error(text.tools.artifactNotFound(input.handle));
  }
  return { content: result.content, size: result.size };
}
