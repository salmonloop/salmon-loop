import { readFile } from 'fs/promises';
import { join } from 'path';

import { describe, expect, it } from 'bun:test';

const directPhaseFiles = [
  'src/core/grizzco/steps/plan.ts',
  'src/core/grizzco/steps/explore.ts',
  'src/core/grizzco/steps/research.ts',
];

describe('architecture/request-assembly invariant', () => {
  it('direct phase steps use shared buildPhaseRequestEnvelope helper', async () => {
    for (const relPath of directPhaseFiles) {
      const content = await readFile(join(process.cwd(), relPath), 'utf8');
      expect(content).toContain('buildPhaseRequestEnvelope');
    }
  });

  it('patch step delegates envelope building to patch/prompt-input helper', async () => {
    const patchStep = await readFile(
      join(process.cwd(), 'src/core/grizzco/steps/patch.ts'),
      'utf8',
    );
    const patchPromptInput = await readFile(
      join(process.cwd(), 'src/core/grizzco/steps/patch/prompt-input.ts'),
      'utf8',
    );

    expect(patchStep).toContain('buildPatchPromptInput');
    expect(patchPromptInput).toContain('buildPhaseRequestEnvelope');
  });

  it('phase steps do not directly build request envelope', async () => {
    for (const relPath of [
      ...directPhaseFiles,
      'src/core/grizzco/steps/patch.ts',
      'src/core/grizzco/steps/patch/prompt-input.ts',
    ]) {
      const content = await readFile(join(process.cwd(), relPath), 'utf8');
      expect(content).not.toContain('buildRequestEnvelope(');
      expect(content).not.toContain('materializeRequestEnvelope(');
      expect(content).not.toContain('resolveRequestArtifactHints(');
    }
  });

  it('shared request assembly explicitly declares cache-safe request mode', async () => {
    const requestAssembly = await readFile(
      join(process.cwd(), 'src/core/grizzco/steps/request-assembly.ts'),
      'utf8',
    );
    const aiSdk = await readFile(join(process.cwd(), 'src/core/llm/ai-sdk.ts'), 'utf8');

    expect(requestAssembly).toContain("mode: 'cache_safe_only'");
    expect(aiSdk).toContain("mode: 'cache_safe_only'");
  });

  it('phase tool-calling steps use a shared runtime context helper for sub-agent snapshots', async () => {
    for (const relPath of [
      'src/core/grizzco/steps/plan.ts',
      'src/core/grizzco/steps/explore.ts',
      'src/core/grizzco/steps/research.ts',
      'src/core/grizzco/steps/patch.ts',
    ]) {
      const content = await readFile(join(process.cwd(), relPath), 'utf8');
      expect(content).toContain('buildPhaseToolRuntimeContext');
      expect(content).not.toContain('contextSnapshot: {');
    }
  });
});
