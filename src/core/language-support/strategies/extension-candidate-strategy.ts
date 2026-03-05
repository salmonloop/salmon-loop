import type { DecisionEngine } from '../../grizzco/dsl/DecisionEngine.js';
import { tryGetPluginRegistry } from '../../plugin/registry.js';

export interface ExtensionCandidateContext {
  importPath: string;
  basePath: string;
  data?: {
    extensions?: string[];
    candidates?: string[];
  };
}

export function extensionCandidateStrategy(engine: DecisionEngine<ExtensionCandidateContext>) {
  engine
    .phase('collect')
    .requireData('extensions', 'All registered extensions from plugins')
    .phase('build')
    .when(
      (ctx) => (ctx.data?.extensions?.length ?? 0) > 0,
      (pb) =>
        pb.addAction('BUILD_CANDIDATES', {
          extensions: pb.ctx.data?.extensions,
        }),
    )
    .phase('resolution')
    .setWorker('extension-resolver');
}

export async function resolveExtensionData(
  ctx: ExtensionCandidateContext,
  key: string,
): Promise<unknown> {
  if (key === 'extensions') {
    const allPlugins = tryGetPluginRegistry()?.getAll() ?? [];
    const extensions = new Set<string>();
    for (const plugin of allPlugins) {
      for (const ext of plugin.meta.extensions) {
        const normalized = ext.startsWith('.') ? ext : `.${ext}`;
        extensions.add(normalized);
      }
    }
    return Array.from(extensions);
  }
  return undefined;
}
