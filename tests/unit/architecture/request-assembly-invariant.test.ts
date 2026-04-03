import { readFile } from 'fs/promises';
import { join } from 'path';

import { describe, expect, it } from 'bun:test';

const directPhaseFiles = [
  'src/core/grizzco/steps/plan.ts',
  'src/core/grizzco/steps/explore.ts',
  'src/core/grizzco/steps/research.ts',
];

const sharedAssemblyConsumers = [
  ...directPhaseFiles,
  'src/core/grizzco/steps/answer.ts',
  'src/core/grizzco/steps/patch.ts',
  'src/core/grizzco/steps/patch/prompt-input.ts',
  'src/core/llm/ai-sdk.ts',
  'src/core/llm/message-composition.ts',
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
    for (const relPath of sharedAssemblyConsumers) {
      const content = await readFile(join(process.cwd(), relPath), 'utf8');
      expect(content).not.toContain('buildRequestEnvelope(');
      expect(content).not.toContain('materializeRequestEnvelope(');
      expect(content).not.toContain('resolveRequestArtifactHints(');
    }
  });

  it('answer step delegates envelope building to shared request assembly helper', async () => {
    const content = await readFile(join(process.cwd(), 'src/core/grizzco/steps/answer.ts'), 'utf8');
    expect(content).toContain('buildSharedRequestEnvelope');
  });

  it('shared request assembly explicitly declares cache-safe request mode', async () => {
    const requestAssembly = await readFile(
      join(process.cwd(), 'src/core/llm/shared-request-assembly.ts'),
      'utf8',
    );

    expect(requestAssembly).toContain("mode: 'cache_safe_only'");
  });

  it('chat message composition delegates envelope building to shared request assembly helper', async () => {
    const content = await readFile(join(process.cwd(), 'src/core/llm/message-composition.ts'), 'utf8');
    expect(content).toContain('buildSharedRequestEnvelope');
  });

  it('ai-sdk high-level prompt APIs delegate envelope building to shared request assembly helper', async () => {
    const content = await readFile(join(process.cwd(), 'src/core/llm/ai-sdk.ts'), 'utf8');
    expect(content).toContain('buildSharedRequestEnvelope');
  });

  it('ai-sdk keeps high-level phase configuration centralized and mapped through runHighLevelPhase', async () => {
    const aiSdk = await readFile(join(process.cwd(), 'src/core/llm/ai-sdk.ts'), 'utf8');
    const specs = await readFile(
      join(process.cwd(), 'src/core/llm/ai-sdk/high-level-phase-specs.ts'),
      'utf8',
    );

    expect(aiSdk).toContain('runHighLevelPhase');
    expect(aiSdk).toContain('HIGH_LEVEL_PHASE_SPECS.plan');
    expect(aiSdk).toContain('HIGH_LEVEL_PHASE_SPECS.patch');

    expect(specs).toContain('HIGH_LEVEL_PHASE_SPECS');
    expect(specs).toContain("plan:");
    expect(specs).toContain("namespace: 'plan'");
    expect(specs).toContain("observationName: 'PLAN:plan-json'");
    expect(specs).toContain('buildPrompt');
    expect(specs).toContain('buildAttachments');
    expect(specs).toContain('parseResult');
    expect(specs).toContain("patch:");
    expect(specs).toContain("namespace: 'patch'");
    expect(specs).toContain("observationName: 'PATCH:unified-diff'");
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

  it('tool session paths preserve runtime context through shared execution planner', async () => {
    const session = await readFile(join(process.cwd(), 'src/core/tools/session.ts'), 'utf8');

    expect(session).toContain('{ ...params.session.runtime, phase: params.phase }');
    expect(session).toContain(
      'await executeToolCalls(session, phase, round, toolCalls, messages, chatOptions.signal);',
    );
    expect(session).toContain(
      'await executeToolCalls(session, phase, round, calls, messages, chatOptions.signal);',
    );
  });
});
