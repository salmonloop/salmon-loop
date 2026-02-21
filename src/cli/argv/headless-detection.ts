export type DetectedHeadlessOutput = {
  repoPath?: string;
  instruction?: string;
  resumeSessionId?: string;
  outputFormat: 'json' | 'stream-json' | null;
  outputProfile?: string;
};

function readFlagValue(tokens: string[], index: number): { value?: string; nextIndex: number } {
  const token = tokens[index];
  const eq = token.indexOf('=');
  if (eq !== -1) return { value: token.slice(eq + 1), nextIndex: index };
  const next = tokens[index + 1];
  if (typeof next === 'string') return { value: next, nextIndex: index + 1 };
  return { value: undefined, nextIndex: index };
}

export function detectHeadlessOutputFromArgv(argv: string[]): DetectedHeadlessOutput {
  const tokens = argv.slice(2);

  let repoPath: string | undefined;
  let instruction: string | undefined;
  let resumeSessionId: string | undefined;
  let outputFormat: string | undefined;
  let outputProfile: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === '-r' || token === '--repo' || token.startsWith('--repo=')) {
      const { value, nextIndex } = readFlagValue(tokens, i);
      repoPath = value;
      i = nextIndex;
      continue;
    }

    if (token === '-p' || token === '--print' || token.startsWith('--print=')) {
      const { value, nextIndex } = readFlagValue(tokens, i);
      instruction = value;
      i = nextIndex;
      continue;
    }

    if (token === '--resume' || token.startsWith('--resume=')) {
      const { value, nextIndex } = readFlagValue(tokens, i);
      resumeSessionId = value;
      i = nextIndex;
      continue;
    }

    if (token === '--output-format' || token.startsWith('--output-format=')) {
      const { value, nextIndex } = readFlagValue(tokens, i);
      outputFormat = value;
      i = nextIndex;
      continue;
    }

    if (token === '--output-profile' || token.startsWith('--output-profile=')) {
      const { value, nextIndex } = readFlagValue(tokens, i);
      outputProfile = value;
      i = nextIndex;
      continue;
    }
  }

  const normalized =
    outputFormat === 'json' || outputFormat === 'stream-json' ? outputFormat : null;

  return {
    repoPath,
    instruction,
    resumeSessionId,
    outputFormat: normalized,
    outputProfile,
  };
}
