export const LIMITS = {
  maxFilesChanged: 2,
  maxDiffLines: 200,
  maxRetries: 2,
  maxContextChars: 30000,
  minContextChars: 5000, // Minimum context protection threshold
  verifyOutputMaxLines: 300,
} as const;