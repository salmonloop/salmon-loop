import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';
import { z } from 'zod';

import { readFile } from '../adapters/fs/node-fs.js';
import type { ToolSpec } from '../tools/types.js';

import type { ExplorePromptVars, PatchPromptVars, PlanPromptVars } from './schema.js';

const TEMPLATE_URLS: Record<string, URL> = {
  'system/_tool_defs.hbs': new URL('./templates/system/_tool_defs.hbs', import.meta.url),
  'system/main_system.hbs': new URL('./templates/system/main_system.hbs', import.meta.url),
  'system/explore_system.hbs': new URL('./templates/system/explore_system.hbs', import.meta.url),
  'system/plan_system.hbs': new URL('./templates/system/plan_system.hbs', import.meta.url),
  'system/patch_system.hbs': new URL('./templates/system/patch_system.hbs', import.meta.url),
  'phases/explore_user.hbs': new URL('./templates/phases/explore_user.hbs', import.meta.url),
  'phases/plan_user.hbs': new URL('./templates/phases/plan_user.hbs', import.meta.url),
  'phases/patch_user.hbs': new URL('./templates/phases/patch_user.hbs', import.meta.url),
};

export class PromptRegistry {
  private templates: Map<string, Handlebars.TemplateDelegate> = new Map();
  private initPromise?: Promise<void>;
  private tools: ToolSpec[] = [];

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      Handlebars.registerHelper('json', (context) => JSON.stringify(context, null, 2));

      await this.registerPartial('tool_defs', 'system/_tool_defs.hbs');
      await this.registerPartial('main_system', 'system/main_system.hbs');

      await this.loadTemplate('explore_system', 'system/explore_system.hbs');
      await this.loadTemplate('plan_system', 'system/plan_system.hbs');
      await this.loadTemplate('patch_system', 'system/patch_system.hbs');
      await this.loadTemplate('explore', 'phases/explore_user.hbs');
      await this.loadTemplate('plan', 'phases/plan_user.hbs');
      await this.loadTemplate('patch', 'phases/patch_user.hbs');
    })();

    return this.initPromise;
  }

  private async registerPartial(name: string, relativePath: string): Promise<void> {
    const content = await this.readTemplate(relativePath);
    Handlebars.registerPartial(name, content);
  }

  private async loadTemplate(name: string, relativePath: string): Promise<void> {
    const content = await this.readTemplate(relativePath);
    this.templates.set(name, Handlebars.compile(content));
  }

  private async readTemplate(relativePath: string): Promise<string> {
    const url = TEMPLATE_URLS[relativePath];
    if (!url) {
      throw new Error(`Unknown prompt template path: ${relativePath}`);
    }

    const bunAny = globalThis as any;
    const bun: any = bunAny.Bun;
    if (bun?.file) {
      return bun.file(url).text();
    }

    return readFile(fileURLToPath(url), 'utf-8');
  }

  private render(name: string, data: unknown): string {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`Prompt template "${name}" not found (did you call promptRegistry.init()?)`);
    }
    return template(data);
  }

  /**
   * Set the tool definitions to be injected into prompts
   */
  setTools(tools: ToolSpec[]): void {
    this.tools = tools;
  }

  /**
   * Get serializable tool definitions for template rendering
   */
  private getToolsForTemplate() {
    return this.tools.map((spec) => ({
      name: spec.name,
      source: spec.source,
      intent: spec.intent,
      description: spec.description,
      riskLevel: spec.riskLevel,
      sideEffects: spec.sideEffects,
      allowedPhases: spec.allowedPhases,
      defaultTimeoutMs: spec.defaultTimeoutMs,
      // Convert Zod schemas to JSON Schema for LLM consumption
      inputSchema: this.zodToJsonSchema(spec.inputSchema),
      outputSchema: this.zodToJsonSchema(spec.outputSchema),
    }));
  }

  /**
   * Convert Zod schema to a simplified JSON Schema representation
   * Note: This is a basic conversion. For production, consider using zod-to-json-schema library.
   */
  private zodToJsonSchema(zodSchema: any): any {
    if (!zodSchema) {
      return { type: 'object', description: 'Schema details unavailable' };
    }

    const unwrapForJsonSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
      let current: z.ZodTypeAny = schema;
      for (let depth = 0; depth < 20; depth++) {
        const ZodEffects: any = (z as any).ZodEffects;
        if (typeof ZodEffects === 'function' && current instanceof ZodEffects) {
          current = (current as any)._def.schema;
          continue;
        }
        if (current instanceof z.ZodPipe) {
          current = (current as any)._def.out;
          continue;
        }
        if (current instanceof z.ZodOptional) {
          current = (current as any)._def.innerType;
          continue;
        }
        if (current instanceof z.ZodNullable) {
          current = (current as any)._def.innerType;
          continue;
        }
        if (current instanceof z.ZodDefault) {
          current = (current as any)._def.innerType;
          continue;
        }
        break;
      }
      return current;
    };

    try {
      const schema = z.toJSONSchema(unwrapForJsonSchema(zodSchema)) as Record<string, unknown>;

      if (schema && typeof schema === 'object') {
        const { $schema: _ignored, ...rest } = schema as any;
        return rest;
      }
    } catch {
      // Fall through to best-effort fallback
    }

    if (zodSchema?._def?.description) {
      return { description: zodSchema._def.description };
    }

    return { type: 'object', description: 'Schema details available at runtime' };
  }

  renderPlanSystem(): string {
    return this.render('plan_system', { tools: this.getToolsForTemplate() });
  }

  renderPlanSystemWithRuntime(runtime?: unknown): string {
    return this.render('plan_system', { tools: this.getToolsForTemplate(), runtime });
  }

  renderPatchSystem(): string {
    return this.renderPatchSystemWithRuntime(undefined);
  }

  renderPatchSystemWithRuntime(runtime?: unknown): string {
    return this.render('patch_system', { tools: this.getToolsForTemplate(), runtime });
  }

  renderExploreSystem(): string {
    return this.renderExploreSystemWithRuntime(undefined);
  }

  renderExploreSystemWithRuntime(runtime?: unknown): string {
    return this.render('explore_system', { tools: this.getToolsForTemplate(), runtime });
  }

  renderExplore(vars: ExplorePromptVars): string {
    return this.render('explore', vars);
  }

  renderPlan(vars: PlanPromptVars): string {
    return this.render('plan', vars);
  }

  renderPatch(vars: PatchPromptVars): string {
    return this.render('patch', vars);
  }
}

export const promptRegistry = new PromptRegistry();
