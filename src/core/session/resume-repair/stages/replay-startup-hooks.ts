import type { ResumeRepairStage } from '../types.js';

export const replayStartupHooksStage: ResumeRepairStage = async (state, context) => {
  const executed = new Set<string>();
  for (const hook of context.startupHooks) {
    if (!hook?.key || executed.has(hook.key)) continue;
    executed.add(hook.key);
    try {
      await hook.run(state.session, {
        now: context.now,
        nextId: context.nextId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.contractViolations.push({
        code: 'STARTUP_HOOK_FAILED',
        message: `Startup hook "${hook.key}" failed: ${reason}`,
      });
      return;
    }
  }
};
