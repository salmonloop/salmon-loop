import { redactSensitiveValue } from '../../security/redaction.js';
import type {
  AskUserInput,
  AskUserOption,
  AskUserOutput,
  AskUserQuestion,
  UserInputProvider,
} from '../../types/runtime.js';

export type McpElicitationAction = 'accept' | 'decline' | 'cancel';

export interface McpElicitResult {
  action: McpElicitationAction;
  content?: Record<string, string | number | boolean | string[]>;
}

export interface McpElicitAuditPayload {
  event: 'mcp.elicitation.create';
  mode: 'form' | 'url';
  action: McpElicitationAction;
  questionCount: number;
  request: unknown;
  response?: unknown;
  deniedReason?: 'provider_unavailable' | 'unsupported_schema';
}

export interface McpElicitResponse {
  result: McpElicitResult;
  audit: McpElicitAuditPayload;
}

export interface McpElicitationProviderOptions {
  userInputProvider?: UserInputProvider;
}

interface McpElicitationPolicyEngine {
  decideElicitation(server: string): {
    allowed: boolean;
    denyReason?: string;
  };
}

interface McpElicitFormParams {
  mode?: 'form';
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

interface McpElicitUrlParams {
  mode: 'url';
  message: string;
  elicitationId: string;
  url: string;
}

export type McpElicitParams = McpElicitFormParams | McpElicitUrlParams;

interface BuiltQuestions {
  input: AskUserInput;
  keyByQuestion: Map<string, string>;
}

function isElicitationOptions(value: unknown): value is McpElicitationProviderOptions {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'userInputProvider' in value &&
    !('decideElicitation' in value),
  );
}

function option(label: string, description?: string): AskUserOption {
  return { label, description: description || label };
}

function enumValues(schema: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === 'string')) {
    return schema.enum as string[];
  }
  if (
    Array.isArray(schema.oneOf) &&
    schema.oneOf.every(
      (value) =>
        value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).const === 'string',
    )
  ) {
    return schema.oneOf.map((value) => String((value as Record<string, unknown>).const));
  }
  return undefined;
}

function arrayEnumValues(schema: Record<string, unknown>): string[] | undefined {
  if (schema.type !== 'array' || !schema.items || typeof schema.items !== 'object') {
    return undefined;
  }
  const items = schema.items as Record<string, unknown>;
  if (Array.isArray(items.enum) && items.enum.every((value) => typeof value === 'string')) {
    return items.enum as string[];
  }
  if (
    Array.isArray(items.anyOf) &&
    items.anyOf.every(
      (value) =>
        value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).const === 'string',
    )
  ) {
    return items.anyOf.map((value) => String((value as Record<string, unknown>).const));
  }
  return undefined;
}

function questionHeader(key: string, schema: Record<string, unknown>): string {
  return String(schema.title || key);
}

function questionText(key: string, schema: Record<string, unknown>, required: boolean): string {
  const description = typeof schema.description === 'string' ? schema.description : '';
  const suffix = required ? '' : ' (optional)';
  return description || `${questionHeader(key, schema)}${suffix}`;
}

function buildQuestionForProperty(
  key: string,
  schema: Record<string, unknown>,
  required: boolean,
): AskUserQuestion | undefined {
  if (schema.type === 'boolean') {
    return {
      question: questionText(key, schema, required),
      header: questionHeader(key, schema),
      options: [option('true', 'Yes'), option('false', 'No')],
      multiSelect: false,
    };
  }

  const values = schema.type === 'array' ? arrayEnumValues(schema) : enumValues(schema);
  if (values && values.length >= 2 && values.length <= 4) {
    return {
      question: questionText(key, schema, required),
      header: questionHeader(key, schema),
      options: values.map((value) => option(value)),
      multiSelect: schema.type === 'array',
    };
  }

  return undefined;
}

function buildFormQuestions(params: McpElicitFormParams): BuiltQuestions | undefined {
  const required = new Set(params.requestedSchema.required ?? []);
  const questions: AskUserQuestion[] = [];
  const keyByQuestion = new Map<string, string>();

  for (const [key, schema] of Object.entries(params.requestedSchema.properties)) {
    const question = buildQuestionForProperty(key, schema, required.has(key));
    if (!question) return undefined;
    questions.push(question);
    keyByQuestion.set(question.question, key);
  }

  if (questions.length === 0) return undefined;
  return { input: { questions }, keyByQuestion };
}

function buildUrlQuestion(params: McpElicitUrlParams): BuiltQuestions {
  const question: AskUserQuestion = {
    question: params.message,
    header: 'MCP URL request',
    options: [option('accept', params.url), option('decline', 'Decline')],
    multiSelect: false,
  };
  return {
    input: { questions: [question] },
    keyByQuestion: new Map([[question.question, 'url']]),
  };
}

function responseContent(
  output: AskUserOutput,
  keyByQuestion: Map<string, string>,
): Record<string, string | number | boolean | string[]> {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [question, answer] of Object.entries(output.answers)) {
    const key = keyByQuestion.get(question);
    if (!key) continue;
    if (answer.includes(',')) {
      content[key] = answer
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    } else if (answer === 'true') {
      content[key] = true;
    } else if (answer === 'false') {
      content[key] = false;
    } else {
      content[key] = answer;
    }
  }
  return content;
}

async function askUser(
  provider: UserInputProvider,
  input: AskUserInput,
  options: { signal?: AbortSignal } = {},
): Promise<AskUserOutput> {
  return provider.askUser(input, { signal: options.signal });
}

export class McpElicitationProvider {
  private readonly policy?: McpElicitationPolicyEngine;
  private readonly userInputProvider?: UserInputProvider;

  constructor(options?: McpElicitationProviderOptions);
  constructor(policy: McpElicitationPolicyEngine, userInputProvider?: UserInputProvider);
  constructor(
    optionsOrPolicy?: McpElicitationProviderOptions | McpElicitationPolicyEngine,
    userInputProvider?: UserInputProvider,
  ) {
    if (isElicitationOptions(optionsOrPolicy) || !optionsOrPolicy) {
      this.userInputProvider = optionsOrPolicy?.userInputProvider;
      return;
    }
    this.policy = optionsOrPolicy;
    this.userInputProvider = userInputProvider;
  }

  async ask(input: {
    server: string;
    prompt: string;
    questions: Array<{ id: string; label: string }>;
  }): Promise<{ answers: Record<string, string>; audit: Record<string, unknown> }> {
    if (!this.policy) throw new Error('MCP_ELICITATION_POLICY_UNAVAILABLE');
    const decision = this.policy.decideElicitation(input.server);
    if (!decision.allowed) throw new Error(decision.denyReason ?? 'MCP_ELICITATION_DENIED');
    if (!this.userInputProvider) throw new Error('MCP_ELICITATION_UNAVAILABLE');
    const questions = input.questions.map((question) => ({
      question: question.id,
      header: question.label,
      options: [option('answer', question.label), option('skip', 'Skip')],
      multiSelect: false,
    }));
    const response = await askUser(this.userInputProvider, { questions });
    return {
      answers: response.answers,
      audit: {
        server: input.server,
        questionCount: input.questions.length,
        answeredCount: Object.keys(response.answers).length,
      },
    };
  }

  async elicit(
    params: McpElicitParams,
    options: { signal?: AbortSignal } = {},
  ): Promise<McpElicitResponse> {
    const mode = params.mode === 'url' ? 'url' : 'form';
    const sanitizedRequest = redactSensitiveValue(params).value;

    if (!this.userInputProvider) {
      return {
        result: { action: 'decline' },
        audit: {
          event: 'mcp.elicitation.create',
          mode,
          action: 'decline',
          questionCount: 0,
          request: sanitizedRequest,
          deniedReason: 'provider_unavailable',
        },
      };
    }

    const built =
      mode === 'url'
        ? buildUrlQuestion(params as McpElicitUrlParams)
        : buildFormQuestions(params as McpElicitFormParams);
    if (!built) {
      return {
        result: { action: 'decline' },
        audit: {
          event: 'mcp.elicitation.create',
          mode,
          action: 'decline',
          questionCount: 0,
          request: sanitizedRequest,
          deniedReason: 'unsupported_schema',
        },
      };
    }

    const output = await askUser(this.userInputProvider, built.input, { signal: options.signal });
    const content = responseContent(output, built.keyByQuestion);
    const action =
      mode === 'url' && content.url === 'decline'
        ? 'decline'
        : Object.keys(content).length > 0
          ? 'accept'
          : 'cancel';

    const result: McpElicitResult =
      action === 'accept' ? { action, content: mode === 'url' ? undefined : content } : { action };

    return {
      result,
      audit: {
        event: 'mcp.elicitation.create',
        mode,
        action,
        questionCount: built.input.questions.length,
        request: sanitizedRequest,
        response: redactSensitiveValue(result).value,
      },
    };
  }
}
