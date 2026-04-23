import { describe, expect, it } from 'bun:test';

import { readFile } from '../../../../src/core/adapters/fs/node-fs.js';
import { defaultPathAdapter } from '../../../../src/core/adapters/path/path-adapter.js';
import { parseConfigText } from '../../../../src/core/config/file-format.js';
import { validateConfigFileV1 } from '../../../../src/core/config/validate.js';

async function loadConfigExample(filename: string) {
  const repoRoot = defaultPathAdapter.resolve(process.cwd());
  const filePath = defaultPathAdapter.join(repoRoot, filename);
  const raw = await readFile(filePath, 'utf8');
  const parsed = parseConfigText(raw, filePath);
  return validateConfigFileV1(parsed);
}

describe('config examples', () => {
  it('include server defaults in the JSON example', async () => {
    const config = await loadConfigExample('config.example.json');

    expect(config.server?.a2a?.host).toBeDefined();
    expect(config.server?.a2a?.port).toBeDefined();
    expect(config.server?.acp).toBeDefined();
    expect(config.server ? 'sidecar' in config.server : false).toBe(false);
  });

  it('include server defaults in the YAML example', async () => {
    const config = await loadConfigExample('config.example.yaml');

    expect(config.server?.a2a?.host).toBeDefined();
    expect(config.server?.a2a?.port).toBeDefined();
    expect(config.server?.acp).toBeDefined();
    expect(config.server ? 'sidecar' in config.server : false).toBe(false);
  });
});
