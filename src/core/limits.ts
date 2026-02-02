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
  defaultSearchMatches: 100,
  maxSearchMatches: 500,

  // Verify
  verifyOutputMaxLines: 300,
  verifyTimeoutMs: Number(process.env.SALMON_VERIFY_TIMEOUT_MS) || 120000,
  worktreePrepareTimeoutMs: Number(process.env.SALMON_WORKTREE_PREPARE_TIMEOUT_MS) || 600000,

  // Concurrency
  maxConcurrentOperations: Number(process.env.SALMON_MAX_CONCURRENT) || 3,

  // Logging
  maxLogLength: 10000,

  // Monitoring
  maxErrorHistory: 10,

  // Tool execution
  defaultToolTimeoutMs: 30000,
  maxToolOutputBytes: 1048576,

  // Heuristics & Size Limits
  largeFileThresholdBytes: 10240,
  binaryCheckBufferSize: 8192,

  // Cache & Depth
  astCacheSize: 50,
  astCacheTTLMs: 60000,
  maxDependencyDepth: 3,

  // Git timeout
  gitTimeoutMs: 15000,

  // Resource locking
  lockWaitTimeoutMs: 30000, // 30s wait before reporting timeout
  lockStaleThresholdMs: 300000, // 5m stale threshold

  // Retry strategies
  retry: {
    io: {
      initialDelayMs: 100,
      maxDelayMs: 2000,
      maxAttempts: 5,
    },
    api: {
      initialDelayMs: 500,
      maxDelayMs: 10000,
      maxAttempts: 3,
    },
  },
} as const;
