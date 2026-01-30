import type { ResolvedLlmProvider } from '../config/types.js';

import {
  createDefaultLlmRegistry,
  createDefaultOpenAiFallback,
  type CreateRuntimeLlmResult,
  type LlmBackend,
  type LlmFactoryWarningCode,
} from './registry.js';

export type { CreateRuntimeLlmResult, LlmBackend, LlmFactoryWarningCode };

export function createRuntimeLlm(resolved: ResolvedLlmProvider): CreateRuntimeLlmResult {
  const registry = createDefaultLlmRegistry();

  if (resolved.clientPackage) {
    const adapter = registry.resolve({
      providerType: resolved.type,
      clientPackage: resolved.clientPackage,
    });

    if (adapter) {
      return adapter(resolved);
    }

    // If the user requested a package explicitly but it's not registered, keep going with a stable warning.
    const fallback = createDefaultOpenAiFallback(resolved);
    return {
      ...fallback,
      warnings: Array.from(new Set([...fallback.warnings, 'CLIENT_PACKAGE_NOT_SUPPORTED'])),
    };
  }

  return createDefaultOpenAiFallback(resolved);
}
