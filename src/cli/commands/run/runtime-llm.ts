import {
  createPhaseRoutingLlm,
  createRuntimeLlm,
  EXECUTION_PHASES,
  getLogger,
  Phase,
  type ExecutionPhase,
  type LlmFactoryWarningCode,
} from '../../../core/facades/cli-run-runtime-llm.js';
import type { ResolvedLlmProvider } from '../../../core/config/types/resolved.js';
import type { HeadlessWarning } from '../../headless/protocol-metadata.js';
import { text } from '../../locales/index.js';

interface PhaseRoutingTarget {
  id?: string;
  type?: string;
  clientPackage?: string;
  api?: {
    baseUrl?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
    apiKey?: string;
    apiKeySource?: string;
  };
  model?: {
    id?: string;
    slot?: string;
  };
  capabilities?: unknown;
}

function runtimeWarningMessage(
  code: LlmFactoryWarningCode,
  params: { llmType: any; clientPackage: any },
): string {
  if (code === 'API_KEY_MISSING') return text.cli.apiKeyMissing;
  if (code === 'PROVIDER_NOT_SUPPORTED') {
    return text.cli.providerNotSupported(String(params.llmType));
  }
  if (code === 'CLIENT_PACKAGE_NOT_SUPPORTED') {
    return text.cli.clientPackageNotSupported(String(params.clientPackage || ''));
  }
  return code;
}

function toHeadlessWarning(
  code: LlmFactoryWarningCode,
  params: { llmType: any; clientPackage: any },
): HeadlessWarning {
  if (code === 'API_KEY_MISSING') {
    return {
      code: 'LLM_CREDENTIAL_MISSING',
      message:
        'LLM credential not configured; using StubLLM. Configure provider credentials to use a real LLM.',
      source: 'llm.runtime',
      severity: 'warning',
    };
  }

  return {
    code,
    message: runtimeWarningMessage(code, params).replace(/^\[WARN\]\s*/, ''),
    source: 'llm.runtime',
    severity: 'warning',
  };
}

export function createRuntimeLlmAndWarn(params: {
  llmConfig: any;
  langfuseEnabled: boolean;
  headlessOutput?: boolean;
}): {
  llm: any;
  warnings: LlmFactoryWarningCode[];
  headlessWarnings: HeadlessWarning[];
} {
  const runtimeLlm = createRuntimeLlm(params.llmConfig, {
    langfuseEnabled: params.langfuseEnabled,
  });
  const warnings = [...runtimeLlm.warnings];

  const phaseToProviderModel = params.llmConfig?.routing?.phaseToProviderModel;
  const phaseLlms: Partial<Record<ExecutionPhase, any>> = {};
  if (phaseToProviderModel && typeof phaseToProviderModel === 'object') {
    const validPhases = new Set<string>([...EXECUTION_PHASES, Phase.SLASH, Phase.AUTOPILOT]);
    for (const [phase, target] of Object.entries(phaseToProviderModel)) {
      if (!validPhases.has(phase)) continue;
      if (!target || typeof target !== 'object') continue;
      const phaseTarget = target as unknown as PhaseRoutingTarget;
      const perPhaseConfig = {
        id: phaseTarget.id,
        type: phaseTarget.type,
        clientPackage: phaseTarget.clientPackage,
        api: {
          baseUrl: phaseTarget.api?.baseUrl,
          timeoutMs: phaseTarget.api?.timeoutMs,
          headers: phaseTarget.api?.headers,
          apiKey: phaseTarget.api?.apiKey,
          apiKeySource: phaseTarget.api?.apiKeySource,
        },
        models: {
          selectedModelId: phaseTarget.model?.id,
          selectedModelSlot: phaseTarget.model?.slot || 'default',
        },
        capabilities: phaseTarget.capabilities,
      };
      const created = createRuntimeLlm(perPhaseConfig as unknown as ResolvedLlmProvider, {
        langfuseEnabled: params.langfuseEnabled,
      });
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
  const uniqueWarnings = Array.from(new Set(warnings));

  for (const w of uniqueWarnings) {
    if (!params.headlessOutput) {
      getLogger().warn(runtimeWarningMessage(w, { llmType, clientPackage }));
    }
  }

  return {
    llm,
    warnings: uniqueWarnings,
    headlessWarnings: uniqueWarnings.map((w) => toHeadlessWarning(w, { llmType, clientPackage })),
  };
}
