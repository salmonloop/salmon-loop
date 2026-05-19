import { z } from 'zod';

import type {
  SlashCommandSpec,
  SlashHandler,
  SlashHandlerProvider,
  SlashHandlerRequest,
  SlashHandlerResult,
} from '../../slash/types.js';
import type { McpConnectionManager } from '../client/connection-manager.js';
import { jsonSchemaToZod } from '../schema/json-schema-to-zod.js';
import type { McpPromptDescriptor as CatalogMcpPromptDescriptor } from '../types.js';

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  serverName?: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
  inputSchema?: Record<string, unknown>;
}

export interface McpPromptCommand {
  name: string;
  server: string;
  prompt: string;
  description?: string;
  exposure: 'slash' | 'recipe';
  arguments: McpPromptArgument[];
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content:
    | {
        type: 'text';
        text: string;
        [key: string]: unknown;
      }
    | Record<string, unknown>;
}

export interface McpPromptResult {
  description?: string;
  messages: McpPromptMessage[];
  _meta?: Record<string, unknown>;
}

export interface McpPromptClient {
  listPrompts(): Promise<McpPromptDescriptor[]>;
  getPrompt(name: string, args: Record<string, string>): Promise<McpPromptResult>;
}

export interface McpPromptRecipeDescriptor {
  id: string;
  slashCommand: string;
  title: string;
  description: string;
  promptName: string;
  serverName: string;
  inputSchema: Record<string, unknown>;
}

export interface McpPromptInvocation {
  promptName: string;
  serverName: string;
  args: Record<string, string>;
  result: McpPromptResult;
  audit: {
    event: 'mcp.prompt.invoke';
    serverName: string;
    promptName: string;
    args: Record<string, string>;
    messageCount: number;
  };
}

export interface CreateMcpPromptCommandProviderOptions {
  serverName: string;
  client: McpPromptClient;
  commandPrefix?: string;
  order?: number;
}

interface McpPromptPolicyEngine {
  decidePrompt(input: { server: string; name: string }): {
    allowed: boolean;
    denyReason?: string;
    grant?: {
      kind: string;
      exposeAs?: 'slash' | 'recipe' | 'none';
    };
  };
}

const SAFE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function safeToken(value: string, fallback: string): string {
  const normalized = normalizeToken(value);
  if (SAFE_TOKEN_PATTERN.test(normalized)) return normalized;
  return fallback;
}

function isPromptOptions(value: unknown): value is CreateMcpPromptCommandProviderOptions {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'serverName' in value &&
    'client' in value &&
    typeof (value as any).client?.listPrompts === 'function',
  );
}

function buildFallbackSchemaFromArguments(args: McpPromptArgument[] = []): z.ZodType<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args) {
    const field = z.string().describe(arg.description ?? '');
    shape[arg.name] = arg.required ? field : field.optional();
  }
  return z.object(shape).strict();
}

function buildJsonSchemaFromArguments(args: McpPromptArgument[] = []): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(
      args.map((arg) => [
        arg.name,
        {
          type: 'string',
          description: arg.description,
        },
      ]),
    ),
    required: args.filter((arg) => arg.required).map((arg) => arg.name),
    additionalProperties: false,
  };
}

function parseSlashArgs(req: SlashHandlerRequest): Record<string, unknown> {
  const raw = req.argsText.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Prompt arguments must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid MCP prompt arguments for ${req.command.name}: ${message}`);
  }
}

function coercePromptArgs(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (typeof value === 'string') return [key, value];
      if (typeof value === 'number' || typeof value === 'boolean') return [key, String(value)];
      if (value === null || value === undefined) return [key, ''];
      return [key, JSON.stringify(value)];
    }),
  );
}

function renderPromptResultAsForwardedInput(result: McpPromptResult): string {
  return result.messages
    .map((message) => {
      const content = message.content as Record<string, unknown>;
      if (content.type === 'text' && typeof content.text === 'string') {
        return content.text;
      }
      return JSON.stringify(message.content);
    })
    .filter((part) => part.length > 0)
    .join('\n\n');
}

export class McpPromptCommandProvider implements SlashHandlerProvider {
  private readonly manager?: McpConnectionManager;
  private readonly policy?: McpPromptPolicyEngine;
  private readonly serverName?: string;
  private readonly client?: McpPromptClient;
  private readonly commandPrefix: string;
  private readonly order: number;
  private promptsByCommand = new Map<string, McpPromptDescriptor>();
  private promptsByName = new Map<string, McpPromptDescriptor>();

  constructor(options: CreateMcpPromptCommandProviderOptions);
  constructor(manager: McpConnectionManager, policy: McpPromptPolicyEngine);
  constructor(
    optionsOrManager: CreateMcpPromptCommandProviderOptions | McpConnectionManager,
    policy?: McpPromptPolicyEngine,
  ) {
    if (isPromptOptions(optionsOrManager)) {
      this.serverName = optionsOrManager.serverName;
      this.client = optionsOrManager.client;
      this.commandPrefix = safeToken(optionsOrManager.commandPrefix ?? 'mcp', 'mcp');
      this.order = optionsOrManager.order ?? 230;
      return;
    }

    this.manager = optionsOrManager;
    this.policy = policy;
    this.commandPrefix = 'mcp';
    this.order = 230;
  }

  async load(): Promise<void> {
    if (!this.client || !this.serverName) {
      this.promptsByCommand.clear();
      this.promptsByName.clear();
      return;
    }

    const prompts = await this.client.listPrompts();
    this.promptsByCommand.clear();
    this.promptsByName.clear();

    for (const prompt of prompts) {
      const descriptor = { ...prompt, serverName: prompt.serverName ?? this.serverName };
      const command = this.commandNameForPrompt(descriptor);
      this.promptsByCommand.set(command, descriptor);
      this.promptsByName.set(descriptor.name, descriptor);
    }
  }

  listCommands(): McpPromptCommand[] {
    if (!this.manager || !this.policy) {
      return this.listRecipes().map((recipe) => ({
        name: recipe.slashCommand,
        server: recipe.serverName,
        prompt: recipe.promptName,
        description: recipe.description,
        exposure: 'recipe',
        arguments: this.promptsByName.get(recipe.promptName)?.arguments ?? [],
      }));
    }

    const commands: McpPromptCommand[] = [];
    for (const catalog of this.manager.listCatalogs()) {
      for (const prompt of catalog.prompts) {
        const decision = this.policy.decidePrompt({
          server: catalog.serverName,
          name: prompt.name,
        });
        if (!decision.allowed || decision.grant?.kind !== 'prompt') continue;
        commands.push(this.toCommand(prompt, decision.grant.exposeAs ?? 'slash'));
      }
    }
    return commands;
  }

  listSlashCommands(): SlashCommandSpec[] {
    return Array.from(this.promptsByCommand.entries()).map(([name, prompt]) => ({
      name,
      description: this.descriptionForPrompt(prompt),
      order: this.order,
    }));
  }

  listRecipes(): McpPromptRecipeDescriptor[] {
    return Array.from(this.promptsByCommand.entries()).map(([slashCommand, prompt]) => ({
      id: `mcp.${safeToken(prompt.serverName ?? this.serverName ?? 'server', 'server')}.${safeToken(
        prompt.name,
        'prompt',
      )}`,
      slashCommand,
      title: prompt.title ?? prompt.name,
      description: this.descriptionForPrompt(prompt),
      promptName: prompt.name,
      serverName: prompt.serverName ?? this.serverName ?? 'unknown',
      inputSchema: this.jsonSchemaForPrompt(prompt),
    }));
  }

  getHandler(commandName: string): SlashHandler | undefined {
    const prompt = this.promptsByCommand.get(commandName.toLowerCase());
    if (!prompt) return undefined;

    return {
      execute: async (req) => {
        const args = parseSlashArgs(req);
        const invocation = await this.invokePrompt(prompt.name, args);
        const input = renderPromptResultAsForwardedInput(invocation.result);
        const result: SlashHandlerResult = { kind: 'forward', input };
        return result;
      },
    };
  }

  async invoke(input: { server: string; prompt: string; args?: Record<string, string> }) {
    if (!this.manager || !this.policy) {
      return this.invokePrompt(input.prompt, input.args ?? {}).then(
        (invocation) => invocation.result,
      );
    }

    const decision = this.policy.decidePrompt({ server: input.server, name: input.prompt });
    if (!decision.allowed) throw new Error(decision.denyReason ?? 'MCP_PROMPT_DENIED');
    const descriptor = this.manager
      .getCatalog(input.server)
      ?.prompts.find((candidate) => candidate.name === input.prompt);
    if (!descriptor) throw new Error(`MCP prompt not found: ${input.server}.${input.prompt}`);
    const schema = this.buildArgsSchema(descriptor);
    const args = schema.parse(input.args ?? {}) as Record<string, string>;
    return this.manager.getPrompt(input.server, input.prompt, args);
  }

  async invokePrompt(
    name: string,
    rawArgs: Record<string, unknown> = {},
  ): Promise<McpPromptInvocation> {
    if (!this.client) {
      throw new Error('MCP prompt client is not configured for direct invocation.');
    }
    const prompt = this.promptsByName.get(name);
    if (!prompt) {
      throw new Error(`MCP prompt not found: ${this.serverName ?? 'unknown'}/${name}`);
    }

    const args = this.validatePromptArgs(prompt, rawArgs);
    const result = await this.client.getPrompt(prompt.name, args);
    return {
      promptName: prompt.name,
      serverName: prompt.serverName ?? this.serverName ?? 'unknown',
      args,
      result,
      audit: {
        event: 'mcp.prompt.invoke',
        serverName: prompt.serverName ?? this.serverName ?? 'unknown',
        promptName: prompt.name,
        args,
        messageCount: result.messages.length,
      },
    };
  }

  private toCommand(
    prompt: CatalogMcpPromptDescriptor,
    exposure: 'slash' | 'recipe' | 'none',
  ): McpPromptCommand {
    return {
      name: `/mcp.${prompt.serverName}.${prompt.name}`,
      server: prompt.serverName,
      prompt: prompt.name,
      description: prompt.description,
      exposure: exposure === 'recipe' ? 'recipe' : 'slash',
      arguments: prompt.arguments ?? [],
    };
  }

  private buildArgsSchema(prompt: CatalogMcpPromptDescriptor) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const arg of prompt.arguments ?? []) {
      shape[arg.name] = arg.required ? z.string() : z.string().optional();
    }
    return z.object(shape).strict();
  }

  private commandNameForPrompt(prompt: McpPromptDescriptor): string {
    const server = safeToken(prompt.serverName ?? this.serverName ?? 'server', 'server');
    const promptName = safeToken(prompt.name, 'prompt');
    return `/${this.commandPrefix}-${server}-${promptName}`;
  }

  private descriptionForPrompt(prompt: McpPromptDescriptor): string {
    return prompt.description ?? prompt.title ?? `MCP prompt ${prompt.name}`;
  }

  private jsonSchemaForPrompt(prompt: McpPromptDescriptor): Record<string, unknown> {
    return prompt.inputSchema ?? buildJsonSchemaFromArguments(prompt.arguments);
  }

  private zodSchemaForPrompt(prompt: McpPromptDescriptor): z.ZodType<any> {
    if (prompt.inputSchema) {
      return jsonSchemaToZod(prompt.inputSchema);
    }
    return buildFallbackSchemaFromArguments(prompt.arguments);
  }

  private validatePromptArgs(
    prompt: McpPromptDescriptor,
    rawArgs: Record<string, unknown>,
  ): Record<string, string> {
    const schema = this.zodSchemaForPrompt(prompt);
    const parsed = schema.parse(rawArgs);
    return coercePromptArgs(parsed);
  }
}
