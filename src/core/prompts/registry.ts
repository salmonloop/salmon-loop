import { readFile } from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';

import type { PatchPromptVars, PlanPromptVars } from './schema.js';

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export class PromptRegistry {
  private templates: Map<string, Handlebars.TemplateDelegate> = new Map();
  private initPromise?: Promise<void>;

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      Handlebars.registerHelper('json', (context) => JSON.stringify(context, null, 2));

      await this.registerPartial('tool_defs', 'system/_tool_defs.hbs');
      await this.registerPartial('main_system', 'system/main_system.hbs');

      await this.loadTemplate('plan_system', 'system/plan_system.hbs');
      await this.loadTemplate('patch_system', 'system/patch_system.hbs');
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

  renderPlanSystem(): string {
    return this.render('plan_system', {});
  }

  renderPatchSystem(): string {
    return this.render('patch_system', {});
  }

  renderPlan(vars: PlanPromptVars): string {
    return this.render('plan', vars);
  }

  renderPatch(vars: PatchPromptVars): string {
    return this.render('patch', vars);
  }
}

export const promptRegistry = new PromptRegistry();
