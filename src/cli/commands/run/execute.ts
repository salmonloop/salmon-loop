import { emitLlmOutput } from '../../../core/llm/output-policy.js';
import { runSalmonLoop } from '../../../core/runtime/loop.js';
import type { ApplyBackOnDirty, LoopEvent, LoopResult } from '../../../core/types/index.js';
import { createUiAuthorizationProvider } from '../../authorization/provider.js';
import type { SalmonReporter } from '../../reporters/base.js';
import type { UIConfig } from '../../ui/index.js';
import { createCliTaskRunner } from '../../../interfaces/cli/task-runner.js';

export async function executeRunLoop(params: {
  useGui: boolean;
  loopParams: Record<string, unknown>;
  applyBackOnDirty: ApplyBackOnDirty;
  reporter: SalmonReporter;
  llmOutput: any;
  buildAssistantMessage: (result: LoopResult) => string;
  toolAuthorizationConfig?: any;
  guiConfig?: UIConfig;
}): Promise<LoopResult> {
  const build = params.buildAssistantMessage;

  if (params.useGui) {
    const { startGUI } = await import('../../ui/index.js');
    const result = (await startGUI(
      'run',
      undefined,
      async (emit, _input, guiOptions) => {
        const authorizationProvider = createUiAuthorizationProvider({
          emit: (event) => emit({ ...event, timestamp: new Date() }),
          config: params.toolAuthorizationConfig,
        });
        const runResult = await runSalmonLoop({
          ...(params.loopParams as any),
          applyBackOnDirty: params.applyBackOnDirty,
          signal: guiOptions?.signal,
          authorizationProvider,
          authorizationMode: 'deferred',
          onEvent: (event: LoopEvent) => {
            emit(event);
          },
        });
        if (runResult.reason !== 'Operation cancelled by user') {
          emitLlmOutput({
            emit,
            policy: params.llmOutput,
            kind: 'assistant_message',
            step: 'REPORT',
            content: build(runResult),
          });
        }
        return runResult;
      },
      params.guiConfig,
    )) as LoopResult;

    return result;
  }

  const runner = createCliTaskRunner({
    facade: {
      createTask: async ({ capability, request }) =>
        runSalmonLoop({
          ...(params.loopParams as any),
          mode: capability as any,
          instruction: request.instruction,
          applyBackOnDirty: params.applyBackOnDirty,
          onEvent: (event: LoopEvent) => params.reporter.onEvent(event),
        }),
    },
  });
  const result = (await runner.run({
    capability: String((params.loopParams as any).mode ?? 'patch'),
    instruction: String((params.loopParams as any).instruction ?? ''),
  })) as LoopResult;

  emitLlmOutput({
    emit: (event) => params.reporter.onEvent(event),
    policy: params.llmOutput,
    kind: 'assistant_message',
    step: 'REPORT',
    content: build(result),
  });

  return result;
}
