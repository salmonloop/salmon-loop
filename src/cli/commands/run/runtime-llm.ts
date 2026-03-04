import { createRuntimeLlm } from '../../../core/llm/factory.js';
import { createPhaseRoutingLlm } from '../../../core/llm/phase-router.js';
import { logger } from '../../../core/observability/logger.js';
import { EXECUTION_PHASES, Phase, type ExecutionPhase } from '../../../core/types/execution.js';
import { text } from '../../locales/index.js';

export function createRuntimeLlmAndWarn(params: { llmConfig: any; langfuseEnabled: boolean }): {
  llm: any;
  warnings: string[];
} {
  const runtimeLlm = createRuntimeLlm(params.llmConfig, {
    langfuseEnabled: params.langfuseEnabled,
  });
  const warnings = [...runtimeLlm.warnings];

  const phaseToProviderModel = params.llmConfig?.routing?.phaseToProviderModel;
  const phaseLlms: Partial<Record<ExecutionPhase, any>> = {};
  if (phaseToProviderModel && typeof phaseToProviderModel === 'object') {
    const validPhases = new Set<string>([...EXECUTION_PHASES, Phase.SLASH]);
    for (const [phase, target] of Object.entries(phaseToProviderModel)) {
      if (!validPhases.has(phase)) continue;
      if (!target || typeof target !== 'object') continue;
      const perPhaseConfig = {
        id: (target as any).id,
        type: (target as any).type,
        clientPackage: (target as any).clientPackage,
        api: {
          baseUrl: (target as any).api?.baseUrl,
          timeoutMs: (target as any).api?.timeoutMs,
          headers: (target as any).api?.headers,
          apiKey: (target as any).api?.apiKey,
          apiKeySource: (target as any).api?.apiKeySource,
        },
        models: {
          selectedModelId: (target as any).model?.id,
          selectedModelSlot: (target as any).model?.slot || 'default',
        },
      };
      const created = createRuntimeLlm(perPhaseConfig, { langfuseEnabled: params.langfuseEnabled });
      warnings.push(...created.warnings);
      phaseLlms[phase as ExecutionPhase] = created.llm;
    }
  }

  const llm =
    Object.keys(phaseLlms).length > 0
      ? createPhaseRoutingLlm({ defaultLlm: runtimeLlm.llm, phaseLlms })
      : runtimeLlm.llm;

  const llmType = params.llmConfig?.type;
  const clientPackage = params.llmConfig?.clientPackage;

  for (const w of Array.from(new Set(warnings))) {
    if (w === 'API_KEY_MISSING') {
      logger.warn(text.cli.apiKeyMissing);
    } else if (w === 'PROVIDER_NOT_SUPPORTED') {
      logger.warn(text.cli.providerNotSupported(String(llmType)));
    } else if (w === 'CLIENT_PACKAGE_NOT_SUPPORTED') {
      logger.warn(text.cli.clientPackageNotSupported(String(clientPackage || '')));
    }
  }

  return { llm, warnings: Array.from(new Set(warnings)) };
}
