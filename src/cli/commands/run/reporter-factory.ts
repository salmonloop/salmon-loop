import type { StdoutWriter } from '../../headless/stdout-writer.js';
import { AnthropicStreamReporter } from '../../reporters/anthropic-stream.js';
import type { SalmonReporter } from '../../reporters/base.js';
import { JsonReporter } from '../../reporters/json.js';
import { OpenAiStreamReporter } from '../../reporters/openai-stream.js';
import { StandardReporter } from '../../reporters/standard.js';
import { StreamJsonReporter } from '../../reporters/stream-json.js';

import type { OutputFormat } from './types.js';

export interface ReporterFactoryParams {
  useGui: boolean;
  outputFormat: OutputFormat;
  rawOutputProfile?: string;
  repoPath: string;
  sessionIdForOutput?: string;
  writer: StdoutWriter;
  verbose: boolean;
  getStructuredOutput: () => unknown | null;
  getPayloadOverrides: () => Record<string, unknown> | undefined;
  model?: string;
}

function createNoopReporter(): SalmonReporter {
  return {
    onStart: () => {},
    onEvent: () => {},
    onFinish: () => {},
    onError: () => {},
  };
}

export function createRunReporter(params: ReporterFactoryParams): SalmonReporter {
  if (params.useGui) return createNoopReporter();

  if (params.outputFormat === 'stream-json') {
    const profile = params.rawOutputProfile ?? 'native';
    if (profile === 'anthropic') {
      return new AnthropicStreamReporter({
        mode: 'run',
        repoPath: params.repoPath,
        sessionId: params.sessionIdForOutput,
        writer: params.writer,
      });
    }

    if (profile === 'openai') {
      return new OpenAiStreamReporter({
        model: params.model,
        writer: params.writer,
      });
    }

    return new StreamJsonReporter({
      mode: 'run',
      repoPath: params.repoPath,
      sessionId: params.sessionIdForOutput,
      writer: params.writer,
    });
  }

  if (params.outputFormat === 'json') {
    return new JsonReporter({
      mode: 'run',
      repoPath: params.repoPath,
      sessionId: params.sessionIdForOutput,
      writer: params.writer,
      getStructuredOutput: params.getStructuredOutput,
      getPayloadOverrides: params.getPayloadOverrides,
    });
  }

  return new StandardReporter(params.verbose);
}
