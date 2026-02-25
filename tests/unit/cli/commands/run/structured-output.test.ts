import { loadJsonSchema } from '../../../../../src/cli/commands/run/structured-output.js';

const readFile = mock();
const stat = mock();

mock.module('fs/promises', () => ({
  readFile,
  stat,
}));

describe('loadJsonSchema', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('parses inline JSON schema', async () => {
    const schema = await loadJsonSchema({
      schema: JSON.stringify({ type: 'object', properties: { foo: { type: 'string' } } }),
      repoPath: '/repo',
    });

    expect(schema).toMatchObject({
      type: 'object',
      properties: { foo: { type: 'string' } },
    });
  });

  it('rejects oversized inline schema input', async () => {
    const huge = JSON.stringify({ type: 'object', blob: 'x'.repeat(1024 * 1024) });

    await expect(
      loadJsonSchema({
        schema: huge,
        repoPath: '/repo',
      }),
    ).rejects.toThrow(/schema input/i);
  });

  it('loads schema from a repo-relative file path', async () => {
    stat.mockResolvedValue({ size: 32 });
    readFile.mockResolvedValue(JSON.stringify({ type: 'object' }));

    const schema = await loadJsonSchema({
      schema: 'schema.json',
      repoPath: '/repo',
    });

    expect(schema).toMatchObject({ type: 'object' });
  });

  it('rejects oversized schema file input', async () => {
    stat.mockResolvedValue({ size: 1024 * 1024 * 10 });
    readFile.mockResolvedValue(JSON.stringify({ type: 'object' }));

    await expect(
      loadJsonSchema({
        schema: 'schema.json',
        repoPath: '/repo',
      }),
    ).rejects.toThrow(/schema input/i);
  });
});
