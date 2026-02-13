import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ResolvedToolPlugin } from '../../extensions/types.js';
import { logger } from '../../logger.js';
import { Phase } from '../../types.js';
import type { ExecutionPhase } from '../../types.js';
import { ToolRegistry } from '../registry.js';
import type { ToolSpec } from '../types.js';

const FORBIDDEN_PHASES: Set<ExecutionPhase> = new Set([
  Phase.PLAN,
  Phase.PATCH,
  Phase.APPLY,
  Phase.APPLY_BACK,
]);

export async function registerPluginTools(registry: ToolRegistry, plugins: ResolvedToolPlugin[]) {
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    if (plugin.scope === 'user' && !plugin.allowUserScope) {
      logger.warn(`Skipping user plugin ${plugin.id} because allowUserScope is false.`);
      continue;
    }

    let entryPoint = plugin.path;
    try {
      const stats = fs.statSync(entryPoint);
      if (stats.isDirectory()) {
        entryPoint = path.join(entryPoint, 'index.js');
      }
    } catch (error: any) {
      logger.warn(
        `Plugin ${plugin.id} path ${entryPoint} is not accessible: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    const moduleUrl = pathToFileURL(entryPoint).href;
    let manifest: any;
    try {
      const mod = await import(moduleUrl);
      manifest = mod.default ?? mod;
    } catch (error: any) {
      logger.error(
        `Failed to import plugin ${plugin.id} from ${entryPoint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    const registerFn = manifest?.register;
    if (typeof registerFn !== 'function') {
      logger.warn(`Plugin ${plugin.id} does not expose register(); skipping.`);
      continue;
    }

    const pluginId = typeof manifest?.pluginId === 'string' ? manifest.pluginId : plugin.id;
    if (pluginId !== plugin.id) {
      logger.warn(
        `Plugin manifest id ${pluginId} differs from config ${plugin.id}, using config id.`,
      );
    }

    let tools: ToolSpec[] = [];
    try {
      tools = await registerFn();
    } catch (error: any) {
      logger.error(
        `Plugin ${pluginId} register() failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (!Array.isArray(tools)) {
      logger.warn(`Plugin ${pluginId} register() did not return an array; skipping.`);
      continue;
    }

    for (const original of tools) {
      if (!original || typeof original !== 'object') continue;
      const candidateName = original.name;
      if (!candidateName || typeof candidateName !== 'string') {
        logger.warn(`Plugin ${pluginId} exported a tool without a name; skipping.`);
        continue;
      }
      if (original.source !== 'plugin') {
        logger.warn(`Plugin ${pluginId} tool ${original.name} missing source 'plugin'; skipping.`);
        continue;
      }
      if (!original.sideEffects || original.sideEffects.length === 0) {
        logger.warn(`Plugin ${pluginId} tool ${original.name} must declare sideEffects.`);
        continue;
      }
      if (!original.intent) {
        logger.warn(`Plugin ${pluginId} tool ${original.name} must declare intent.`);
        continue;
      }
      if (!original.allowedPhases || original.allowedPhases.length === 0) {
        logger.warn(`Plugin ${pluginId} tool ${original.name} must declare allowedPhases.`);
        continue;
      }
      if (original.allowedPhases.some((phase) => FORBIDDEN_PHASES.has(phase))) {
        logger.warn(
          `Plugin ${pluginId} tool ${original.name} declares forbidden phases; skipping.`,
        );
        continue;
      }

      const normalizedName = candidateName.startsWith(`plugin.${pluginId}.`)
        ? candidateName
        : `plugin.${pluginId}.${candidateName}`;

      const spec: ToolSpec = {
        ...original,
        name: normalizedName,
      };

      registry.register(spec);
      logger.info(`Registered plugin tool ${spec.name} from ${pluginId}`);
    }
  }
}
