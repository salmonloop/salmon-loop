import { readFile } from 'fs/promises';
import { join } from 'path';

import { describe, expect, it } from 'bun:test';

describe('architecture/replacement-preview boundary invariant', () => {
  it('request envelope resolves preview artifacts through preview provider interface', async () => {
    const requestEnvelope = await readFile(
      join(process.cwd(), 'src/core/llm/request-envelope.ts'),
      'utf8',
    );
    expect(requestEnvelope).toContain('previewProvider?: ToolResultPreviewArtifactsProvider');
    expect(requestEnvelope).toContain('params.previewProvider?.getPreviewHints()');
  });

  it('phase request assembly callers pass replacement preview providers', async () => {
    for (const relPath of [
      'src/core/grizzco/steps/explore.ts',
      'src/core/grizzco/steps/plan.ts',
      'src/core/grizzco/steps/research.ts',
      'src/core/grizzco/steps/patch/prompt-input.ts',
    ]) {
      const content = await readFile(join(process.cwd(), relPath), 'utf8');
      expect(content).toContain('SessionReplacementPreviewProvider');
      expect(content).toContain('previewProvider:');
    }
  });
});
