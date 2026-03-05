import { MicroTaskRunner } from '../grizzco/dsl/MicroTaskRunner.js';

import {
  extensionCandidateStrategy,
  resolveExtensionData,
  type ExtensionCandidateContext,
} from './strategies/extension-candidate-strategy.js';
import {
  languageQueryStrategy,
  resolveQueryData,
  type QueryContext,
} from './strategies/language-query-strategy.js';

export class LanguageSupportOrchestrator {
  private queryRunner = new MicroTaskRunner<QueryContext>({
    strategy: languageQueryStrategy,
    resolveData: resolveQueryData,
    maxRounds: 5,
    debugLabel: 'language-query',
  });

  private extensionRunner = new MicroTaskRunner<ExtensionCandidateContext>({
    strategy: extensionCandidateStrategy,
    resolveData: resolveExtensionData,
    maxRounds: 3,
    debugLabel: 'extension-candidate',
  });

  async getASTQuery(lang: string, queryType: 'definitions' | 'references'): Promise<string | null> {
    const result = await this.queryRunner.decide({
      lang,
      queryType,
      data: {},
    });
    return result.context.data?.pluginQuery ?? null;
  }

  async getExtensionCandidates(importPath: string, basePath: string): Promise<string[]> {
    const result = await this.extensionRunner.decide({
      importPath,
      basePath,
      data: {},
    });
    return result.context.data?.extensions ?? [];
  }
}

export function createLanguageSupportOrchestrator(): LanguageSupportOrchestrator {
  return new LanguageSupportOrchestrator();
}
