import { createRuntimeLlm } from '../../../core/llm/factory.js';
import { logger } from '../../../core/observability/logger.js';
import { text } from '../../locales/index.js';

export function createRuntimeLlmAndWarn(params: { llmConfig: any; langfuseEnabled: boolean }): {
  llm: any;
  warnings: string[];
} {
  const runtimeLlm = createRuntimeLlm(params.llmConfig, {
    langfuseEnabled: params.langfuseEnabled,
  });

  const llmType = params.llmConfig?.type;
  const clientPackage = params.llmConfig?.clientPackage;

  for (const w of runtimeLlm.warnings) {
    if (w === 'API_KEY_MISSING') {
      logger.warn(text.cli.apiKeyMissing);
    } else if (w === 'PROVIDER_NOT_SUPPORTED') {
      logger.warn(text.cli.providerNotSupported(String(llmType)));
    } else if (w === 'CLIENT_PACKAGE_NOT_SUPPORTED') {
      logger.warn(text.cli.clientPackageNotSupported(String(clientPackage || '')));
    }
  }

  return { llm: runtimeLlm.llm, warnings: runtimeLlm.warnings };
}
