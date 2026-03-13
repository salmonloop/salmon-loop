import type { RunCommandValidatedOptions } from './types.js';

export function validateRunCommandOptions(params: {
  parsed: RunCommandValidatedOptions;
}): { ok: true } | { ok: false; code: 'USAGE_ERROR'; message: string } {
  const { parsed } = params;

  if (parsed.explicitInstruction && parsed.printInstruction) {
    return { ok: false, code: 'USAGE_ERROR', message: 'PRINT_INSTRUCTION_CONFLICT' };
  }

  if (parsed.continueSession && parsed.resumeSessionId) {
    return { ok: false, code: 'USAGE_ERROR', message: 'CONTINUE_RESUME_CONFLICT' };
  }

  if (parsed.rawOutputProfile && parsed.outputFormat !== 'stream-json') {
    return { ok: false, code: 'USAGE_ERROR', message: 'OUTPUT_PROFILE_REQUIRES_STREAM_JSON' };
  }

  if (parsed.outputFormat === 'stream-json') {
    const outputProfile = parsed.outputProfileForStreamJson;
    if (outputProfile !== 'native' && outputProfile !== 'anthropic' && outputProfile !== 'openai') {
      return { ok: false, code: 'USAGE_ERROR', message: 'INVALID_OUTPUT_PROFILE' };
    }
  }

  if (parsed.jsonSchemaSpec && parsed.outputFormat !== 'json') {
    return { ok: false, code: 'USAGE_ERROR', message: 'JSON_SCHEMA_REQUIRES_JSON' };
  }

  return { ok: true };
}
