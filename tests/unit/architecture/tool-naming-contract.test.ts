import { readFile } from 'fs/promises';

import { describe, expect, it } from 'bun:test';

import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';

const CANONICAL_TOOL_NAME =
  /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*)?$/;

const GRANDFATHERED_BUILTIN_TOOL_NAMES = new Set(['agent_dispatch', 'update_knowledge']);
const APPROVED_BENCHMARK_QUALITY_TOOLS = [
  'git.diff_check',
  'git.apply_check',
  'test.run',
  'benchmark.report',
  'swebench.load_instance',
  'swebench.write_prediction',
  'swebench.submit_predictions',
  'swebench.get_report',
] as const;

describe('architecture/tool naming contract', () => {
  it('keeps built-in model-visible tool names canonical or explicitly grandfathered', () => {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);

    const names = registry
      .listAll()
      .map((spec) => spec.name)
      .sort();
    const violations = names.filter(
      (name) => !CANONICAL_TOOL_NAME.test(name) && !GRANDFATHERED_BUILTIN_TOOL_NAMES.has(name),
    );

    expect(violations).toEqual([]);
  });

  it('registers every approved benchmark-quality tool from the governance contract', () => {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);

    const names = new Set(registry.listAll().map((spec) => spec.name));

    for (const toolName of APPROVED_BENCHMARK_QUALITY_TOOLS) {
      expect(names.has(toolName)).toBe(true);
    }
  });

  it('keeps the formal governance document aligned with the built-in naming surface', async () => {
    const doc = await readFile('docs/design/tool-governance.md', 'utf8');

    expect(doc).toContain('domain.operation[.qualifier]');
    expect(doc).toContain('Hard syntax rules');
    expect(doc).toContain('Semantic review rules');
    expect(doc).toContain('Grandfathered built-in names');
    expect(doc).toContain('reversible alias mapping');

    for (const name of GRANDFATHERED_BUILTIN_TOOL_NAMES) {
      expect(doc).toContain(name);
    }
    for (const name of APPROVED_BENCHMARK_QUALITY_TOOLS) {
      expect(doc).toContain(name);
    }
  });
});
