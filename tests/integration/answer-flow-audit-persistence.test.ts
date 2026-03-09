import { readdir, readFile } from 'fs/promises';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import type { ChatOptions, LLM, LLMMessage, Plan } from '../../src/core/types/index.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

class StaticAnswerLlm implements LLM {
  getCapabilities() {
    return { responseFormatJsonObject: true, toolCalling: false, streaming: false };
  }

  getModelId() {
    return 'test-static-answer';
  }

  async chat(_messages: LLMMessage[], _options?: ChatOptions): Promise<LLMMessage> {
    return { role: 'assistant', content: 'Hello from test' };
  }

  async createPlan(): Promise<Plan> {
    throw new Error('not implemented');
  }

  async createPatch(): Promise<string> {
    throw new Error('not implemented');
  }
}

describe('Answer flow audit persistence', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('writes an audit file via SalmonLoopFlow when mode=answer', async () => {
    const repo = await helper.createGitRepo();
    const llm = new StaticAnswerLlm();

    const result = await runSalmonLoop({
      instruction: 'Hello?',
      repoPath: repo.path,
      llm,
      mode: 'answer',
      strategy: 'direct',
      auditScope: 'repo',
    });

    expect(result.success).toBe(true);
    expect(result.assistantMessage).toContain('Hello from test');

    const auditDir = path.join(repo.path, '.salmonloop', 'runtime', 'audit');
    const entries = await readdir(auditDir);
    const auditJson = entries.filter((name) => name.startsWith('audit-') && name.endsWith('.json'));
    expect(auditJson.length).toBeGreaterThan(0);

    const auditPath = path.join(auditDir, auditJson.sort().at(-1) ?? '');
    const parsed = JSON.parse(await readFile(auditPath, 'utf8')) as any;
    expect(parsed?.meta?.success).toBe(true);

    const eventsRel = parsed?.context?.eventsRef?.path;
    expect(typeof eventsRel).toBe('string');
    const eventsPath = path.join(auditDir, eventsRel);
    const eventsText = await readFile(eventsPath, 'utf8');
    expect(typeof eventsText).toBe('string');
  });
});
