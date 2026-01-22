export interface ErrorPattern {
  id: string;
  regex: RegExp;
  suggestion: string;
}

export const ERROR_PATTERNS: ErrorPattern[] = [
  {
    id: 'module-not-found',
    regex: /Cannot find module '(.+)'/,
    suggestion:
      'Check if the package is installed or if the import path matches the file structure.',
  },
  {
    id: 'react-hook-rule',
    regex: /React Hook ".*" is called conditionally/,
    suggestion: 'Move the Hook call to the top level of the component.',
  },
  {
    id: 'ts-type-mismatch',
    regex: /Type '(.+)' is not assignable to type '(.+)'/,
    suggestion: 'Ensure the types match or use a type assertion if appropriate.',
  },
];

export function applyPatterns(message: string): string | undefined {
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.regex.test(message)) {
      return pattern.suggestion;
    }
  }
  return undefined;
}
