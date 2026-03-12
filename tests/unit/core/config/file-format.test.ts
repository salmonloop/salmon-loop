import { describe, expect, it } from 'bun:test';

import { parseConfigText, stringifyConfigText } from '../../../../src/core/config/file-format.js';

describe('config file format', () => {
  it('converts YAML snake_case keys into internal camelCase while preserving map keys', () => {
    const raw = `
version: 1
llm:
  active_model: coding_task
  simple_model: coding_task
  medium_model: coding_task
  complex_model: coding_task
  reasoning_model: coding_task
  providers:
    openai_main:
      type: openai-compatible
      api:
        base_url: https://example.com/v1
        api_key: key
        timeout_ms: 60000
        headers:
          X-API-Key: abc
  models:
    coding_task:
      provider: openai_main
      id: gpt-4o
      params:
        max_tokens: 8192
`;

    const parsed = parseConfigText(raw, '/tmp/config.yaml') as any;

    expect(parsed.llm.activeModel).toBe('coding_task');
    expect(parsed.llm.simpleModel).toBe('coding_task');
    expect(parsed.llm.mediumModel).toBe('coding_task');
    expect(parsed.llm.complexModel).toBe('coding_task');
    expect(parsed.llm.reasoningModel).toBe('coding_task');
    expect(parsed.llm.providers.openai_main.api.baseUrl).toBe('https://example.com/v1');
    expect(parsed.llm.providers.openai_main.api.apiKey).toBe('key');
    expect(parsed.llm.providers.openai_main.api.timeoutMs).toBe(60000);
    expect(parsed.llm.providers.openai_main.api.headers['X-API-Key']).toBe('abc');
    expect(parsed.llm.models.coding_task.params.maxTokens).toBe(8192);
  });

  it('stringifies internal camelCase config back to YAML snake_case keys', () => {
    const text = stringifyConfigText(
      {
        version: 1,
        llm: {
          activeModel: 'coding-task',
          providers: {
            openai_main: {
              type: 'openai-compatible',
              api: {
                baseUrl: 'https://example.com/v1',
                apiKey: 'key',
                timeoutMs: 60000,
                headers: {
                  'X-API-Key': 'abc',
                },
              },
            },
          },
          models: {
            'coding-task': {
              provider: 'openai_main',
              id: 'gpt-4o',
              params: {
                maxTokens: 8192,
              },
            },
          },
        },
      },
      'yaml',
    );

    expect(text).toContain('active_model');
    expect(text).toContain('base_url');
    expect(text).toContain('api_key');
    expect(text).toContain('timeout_ms');
    expect(text).toContain('max_tokens');
    expect(text).toContain('openai_main');
    expect(text).toContain('X-API-Key');
  });

  it('stringifies YAML in block style', () => {
    const text = stringifyConfigText(
      {
        version: 1,
        ui: {
          log: {
            view: 'compact',
            mode: 'normal',
          },
        },
      },
      'yaml',
    );

    expect(text).toContain('ui:\n');
    expect(text).toContain('  log:\n');
    expect(text).toContain('    view: compact');
    expect(text).not.toContain('{');
    expect(text).not.toContain('}');
  });

  it('supports context churn weight keys in snake_case YAML', () => {
    const raw = `
version: 1
context:
  churn:
    weight:
      primary: 12000
      rerank: 0.4
      tiebreak: 0.1
`;
    const parsed = parseConfigText(raw, '/tmp/config.yaml') as any;
    expect(parsed.context.churn.weight.primary).toBe(12000);
    expect(parsed.context.churn.weight.rerank).toBe(0.4);
    expect(parsed.context.churn.weight.tiebreak).toBe(0.1);

    const text = stringifyConfigText(parsed, 'yaml');
    expect(text).toContain('tiebreak');
  });
});
