import { fsReadFileSpec } from '../../../src/core/tools/builtin/fs.js';
import { toolToAnthropic, toolToOpenAI } from '../../../src/core/tools/mapper.js';

describe('tool schema mapping', () => {
  it('exposes required fields for z.preprocess input schemas (fs.read)', () => {
    const openAi = toolToOpenAI(fsReadFileSpec as any);
    const params = openAi.function.parameters as any;

    expect(params.type).toBe('object');
    expect(params.properties?.file).toBeDefined();
    expect(params.required).toContain('file');

    const anthropic = toolToAnthropic(fsReadFileSpec as any);
    const inputSchema = anthropic.input_schema as any;

    expect(inputSchema.type).toBe('object');
    expect(inputSchema.properties?.file).toBeDefined();
    expect(inputSchema.required).toContain('file');
  });
});
