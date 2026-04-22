import { describe, expect, it } from 'bun:test';

import { Phase } from '../../../src/core/types/runtime.js';
import { subAgentTaskSpec } from '../../../src/core/sub-agent/tools/task-spawn.js';
import { fsReadFileSpec, fsWriteFileSpec } from '../../../src/core/tools/builtin/fs.js';
import { planUpdateSpec } from '../../../src/core/tools/builtin/plan.js';
import { shellExecSpec } from '../../../src/core/tools/builtin/shell.js';
import { resolvePhaseVisibleTools } from '../../../src/core/tools/tool-visibility.js';

describe('tool visibility', () => {
  it('shows only AUTOPILOT-allowed tools in autopilot phase', () => {
    const visible = resolvePhaseVisibleTools({
      phase: Phase.AUTOPILOT,
      tools: [
        fsReadFileSpec as any,
        fsWriteFileSpec as any,
        shellExecSpec as any,
        planUpdateSpec as any,
        subAgentTaskSpec as any,
      ],
      runtime: { plan: { sessionId: 'plan-1', planPathHint: '.salmonloop/plan.md' } },
    });

    expect(visible.map((tool) => tool.name)).toEqual([
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
});
