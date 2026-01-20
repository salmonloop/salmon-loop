export const LIMITS = {
  // Patch safety
  maxFilesChanged: 2,
  maxDiffLines: 200,
  maxRetries: 2,

  // Context budget (heuristic, char-based)
  maxContextChars: 30000,
  minContextChars: 5000, // Protect against over-shrinking
  maxPrimaryChars: 12000, // Cap primary file to prevent context explosion

  // Search / shrink
  maxKeywords: 3,
  maxRelatedFiles: 20,
  maxSnippetsAfterShrink: 30,
  minSnippetChars: 64,

  // Verify
  verifyOutputMaxLines: 300,
  verifyTimeoutMs: Number(process.env.SALMON_VERIFY_TIMEOUT_MS) || 120000,

  // Concurrency
  maxConcurrentOperations: Number(process.env.SALMON_MAX_CONCURRENT) || 3,

  // Logging
  maxLogLength: 10000,

  // Monitoring
  maxErrorHistory: 10,
} as const;
