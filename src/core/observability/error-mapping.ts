import { text } from '../../locales/index.js';

import { REDACTED_ERROR_TOKEN } from './error-envelope.js';

export interface ErrorDisplayInput {
  message?: string;
  code?: string;
}

export interface ErrorDisplayOutput {
  message: string;
  code?: string;
  redacted: boolean;
}

function mapLlmCodeToMessage(code: string): string | undefined {
  if (!code.startsWith('LLM_')) return undefined;

  const camelCode = code
    .toLowerCase()
    .replace(/_([a-z])/g, (_, g) => g.toUpperCase())
    .replace(/^llm/, '');
  const finalCamel = camelCode.charAt(0).toLowerCase() + camelCode.slice(1);

  const llmErrors = text.llmErrors as Record<string, string | undefined>;
  const llmText = text.llm as Record<string, unknown>;

  const candidate = llmErrors[finalCamel] ?? llmText[finalCamel];
  return typeof candidate === 'string' ? candidate : undefined;
}

export function mapErrorForDisplay(input: ErrorDisplayInput): ErrorDisplayOutput {
  const rawMessage = input.message ?? '';
  const mappedByCode = input.code ? mapLlmCodeToMessage(input.code) : undefined;
  const isRedacted = rawMessage === REDACTED_ERROR_TOKEN;

  if (isRedacted) {
    return {
      message: text.errors.technicalDetailsHidden,
      code: input.code,
      redacted: true,
    };
  }

  if (mappedByCode) {
    return {
      message: mappedByCode,
      code: input.code,
      redacted: false,
    };
  }

  return {
    message: rawMessage,
    code: input.code,
    redacted: false,
  };
}
