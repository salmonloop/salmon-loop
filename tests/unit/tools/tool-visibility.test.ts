import { describe, expect, it } from 'bun:test';

import { subAgentTaskSpec } from '../../../src/core/sub-agent/tools/task-spawn.js';
import { CodeSearchSpec } from '../../../src/core/tools/builtin/code-search/spec.js';
import { fsReadFileSpec, fsWriteFileSpec } from '../../../src/core/tools/builtin/fs.js';
import { registerAllBuiltins } from '../../../src/core/tools/builtin/index.js';
import { planUpdateSpec } from '../../../src/core/tools/builtin/plan.js';
import { shellExecSpec } from '../../../src/core/tools/builtin/shell.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import {
  resolvePhaseVisibleTools,
  resolveVisibleToolNames,
} from '../../../src/core/tools/tool-visibility.js';
import { Phase } from '../../../src/core/types/runtime.js';

const BENCHMARK_TOOL_NAMES = [
  'git.diff_check',
  'git.apply_check',
  'benchmark.report',
  'swebench.load_instance',
  'swebench.write_prediction',
  'swebench.submit_predictions',
  'swebench.get_report',
];

describe('tool visibility', () => {
  it('shows only AUTOPILOT-allowed tools in autopilot phase', () => {
    const visible = resolvePhaseVisibleTools({
      phase: Phase.AUTOPILOT,
      tools: [
        CodeSearchSpec as any,
        fsReadFileSpec as any,
        fsWriteFileSpec as any,
        shellExecSpec as any,
        planUpdateSpec as any,
        subAgentTaskSpec as any,
      ],
      runtime: { plan: { sessionId: 'plan-1', planPathHint: '.salmonloop/plan.md' } },
    });

    expect(visible.map((tool) => tool.name)).toEqual([
      'code.search',
      'fs.read',
      'fs.write_file',
      'shell.exec',
      'plan.update',
      'agent_dispatch',
    ]);
  });

  it('hides plan.update in AUTOPILOT when runtime plan is absent', () => {
    const visible = resolvePhaseVisibleTools({
      phase: Phase.AUTOPILOT,
      tools: [fsReadFileSpec as any, planUpdateSpec as any, subAgentTaskSpec as any],
    });

    expect(visible.map((tool) => tool.name)).toEqual(['fs.read', 'agent_dispatch']);
  });

  it('keeps shell.exec hidden in phases that do not allow it', () => {
    const visible = resolvePhaseVisibleTools({
      phase: Phase.PLAN,
      tools: [shellExecSpec as any],
      runtime: { plan: { sessionId: 'plan-1', planPathHint: '.salmonloop/plan.md' } },
    });

    expect(visible).toEqual([]);
  });

  it('keeps benchmark artifact tools out of ordinary planning and autopilot phases', () => {
    const registry = new ToolRegistry();
    registerAllBuiltins(registry);
    const toolstack = { registry, policy: new ToolPolicy() };

    const planNames = resolveVisibleToolNames({
      phase: Phase.PLAN,
      toolstack,
      worktreeRoot: '/repo',
      runtime: { plan: { sessionId: 'plan-1', planPathHint: '.salmonloop/plan.md' } },
    });
    const autopilotNames = resolveVisibleToolNames({
      phase: Phase.AUTOPILOT,
      toolstack,
      worktreeRoot: '/repo',
      flowMode: 'autopilot',
      runtime: { plan: { sessionId: 'plan-1', planPathHint: '.salmonloop/plan.md' } },
    });
    const verifyNames = resolveVisibleToolNames({
      phase: Phase.VERIFY,
      toolstack,
      worktreeRoot: '/repo',
    });

    for (const name of BENCHMARK_TOOL_NAMES) {
      expect(planNames).not.toContain(name);
      expect(autopilotNames).not.toContain(name);
      expect(verifyNames).toContain(name);
    }
  });
});
