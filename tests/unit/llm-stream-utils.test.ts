import { mapAiSdkStreamPartToChunk } from '../../src/core/llm/stream-utils.js';

describe('mapAiSdkStreamPartToChunk', () => {
  it('normalizes tool-call input to avoid double-encoded JSON arguments', () => {
    const inputVariants = [
      { file: 'src/main.ts' },
      JSON.stringify({ file: 'src/main.ts' }),
      JSON.stringify(JSON.stringify({ file: 'src/main.ts' })),
    ];

    for (const input of inputVariants) {
      const chunk = mapAiSdkStreamPartToChunk({
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'fs.read',
        input,
      });

      expect(chunk?.tool_calls?.[0]?.function?.name).toBe('fs.read');
      expect(chunk?.tool_calls?.[0]?.function?.arguments).toBe(
        JSON.stringify({ file: 'src/main.ts' }),
      );
    }
  });
});
