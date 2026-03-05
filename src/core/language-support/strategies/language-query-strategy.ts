import type { DecisionEngine } from '../../grizzco/dsl/DecisionEngine.js';
import { tryGetPluginRegistry } from '../../plugin/registry.js';

export interface QueryContext {
  lang: string;
  queryType: 'definitions' | 'references';
  data?: {
    pluginQuery?: string;
    fallbackQuery?: string;
    isSupported?: boolean;
  };
}

export function languageQueryStrategy(engine: DecisionEngine<QueryContext>) {
  engine
    .phase('discovery')
    .requireData('pluginQuery', 'Tree-sitter query from plugin registry')

    .phase('validation')
    .require((ctx) => ctx.data?.pluginQuery !== undefined, 'Plugin must provide query')
    .when(
      (ctx) => !ctx.data?.pluginQuery,
      (pb) =>
        pb.addAction('LOAD_FALLBACK_QUERY', {
          reason: 'No plugin query available',
          lang: pb.ctx.lang,
        }),
    )

    .phase('resolution')
    .setWorker('query-provider');
}

export async function resolveQueryData(ctx: QueryContext, key: string): Promise<unknown> {
  if (key === 'pluginQuery') {
    const plugin = tryGetPluginRegistry()?.getById(ctx.lang);
    if (!plugin) return null;
    return ctx.queryType === 'definitions'
      ? plugin.parsing.queries.definitions
      : plugin.parsing.queries.references;
  }
  return undefined;
}
