import { readFile } from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';

import type { ToolSpec } from '../tools/types.js';

import type { ExplorePromptVars, PatchPromptVars, PlanPromptVars } from './schema.js';

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

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
    const filePath = path.join(TEMPLATE_DIR, relativePath);
    return readFile(filePath, 'utf-8');
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
    // For now, return the schema description
    // In a full implementation, this would convert Zod schemas to JSON Schema
    if (zodSchema?._def?.description) {
      return { description: zodSchema._def.description };
    }
    return { type: 'object', description: 'Schema details available at runtime' };
  }

  renderPlanSystem(): string {
    return this.render('plan_system', { tools: this.getToolsForTemplate() });
  }

  renderPatchSystem(): string {
    return this.render('patch_system', { tools: this.getToolsForTemplate() });
  }

  renderExploreSystem(): string {
    return this.render('explore_system', { tools: this.getToolsForTemplate() });
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
