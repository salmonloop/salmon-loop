import { logger } from '../observability/logger.js';

import { Skill, SkillFrontmatter } from './types.js';

export class SkillParser {
  static parse(content: string, filePath: string): Skill {
    // COMPLIANCE: Lightweight parsing instead of heavy gray-matter
    const yamlRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(yamlRegex);

    if (!match) {
      logger.error(`Failed to parse skill at ${filePath}: Missing frontmatter`);
      return {
        id: filePath,
        path: filePath,
        metadata: {} as SkillFrontmatter,
        rawContent: content,
        instructions: content.trim(),
      };
    }

    const yamlRaw = match[1];
    const instructions = match[2];
    const data: Record<string, any> = {};

    // Simple key-value parser for basic frontmatter
    yamlRaw.split('\n').forEach((line) => {
      const [key, ...value] = line.split(':');
      if (key && value) {
        data[key.trim()] = value.join(':').trim();
      }
    });

    return {
      id: (data.name as string) || filePath,
      path: filePath,
      metadata: data as SkillFrontmatter,
      rawContent: content,
      instructions: instructions.trim(),
    };
  }

  static substituteVariables(template: string, args: Record<string, string>): string {
    let result = template;
    // Sort keys by length descending to prevent shorter keys from replacing parts of longer keys
    const sortedKeys = Object.keys(args).sort((a, b) => b.length - a.length);

    // Track original content to prevent infinite recursion if a value contains its own key
    // We use a single pass approach by replacing markers
    const markers = new Map<string, string>();
    let processedTemplate = template;

    for (let i = 0; i < sortedKeys.length; i++) {
      const key = sortedKeys[i];
      const value = args[key];
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const marker = `__SKILL_VAR_${i}__`;

      const regex = new RegExp(`\\$${escapedKey}\\b|\\$\\{${escapedKey}\\}`, 'g');
      processedTemplate = processedTemplate.replace(regex, marker);
      markers.set(marker, value);
    }

    // Second pass: Replace markers with actual values to ensure no recursion
    result = processedTemplate;
    for (const [marker, value] of markers.entries()) {
      result = result.replace(new RegExp(marker, 'g'), () => value);
    }

    return result;
  }

  static extractCommands(instructions: string): string[] {
    // Matches !sh command or !command
    const commandRegex = /^!(?:sh\s+)?(.*)$/gm;
    const matches = instructions.matchAll(commandRegex);
    return Array.from(matches, (m) => m[1].trim()).filter((cmd) => cmd.length > 0);
  }
}
