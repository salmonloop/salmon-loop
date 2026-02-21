export type OutputFormat = 'text' | 'json' | 'stream-json';

export type StreamJsonOutputProfile = 'native' | 'anthropic' | 'openai';

export type RunCommandMode = 'run';

export interface RunCommandContext {
  mode: RunCommandMode;
  repoPath: string;
  outputFormat: OutputFormat;
  outputProfileForStreamJson: string;
  headlessOutput: boolean;
  printMode: boolean;
}

export interface RunCommandParsedOptions {
  allOptions: any;
  repoPath: string;
  continueSession: boolean;
  resumeSessionId?: string;
  printInstruction?: string;
  explicitInstruction?: string;
  instruction?: string;
  jsonSchemaSpec?: string;
  rawOutputFormat: string;
  rawOutputProfile?: string;
  outputProfileForStreamJson: string;
  headlessIncludeToolInput: boolean;
  headlessIncludeToolOutput: boolean;
  headlessIncludeAuthorizationDecisions: boolean;
}

export interface RunCommandValidatedOptions extends RunCommandParsedOptions {
  outputFormat: OutputFormat;
  headlessOutput: boolean;
  printMode: boolean;
  useGui: boolean;
  wantSessionPersistence: boolean;
}
