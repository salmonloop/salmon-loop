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
  verifyTimeoutMs: Number(process.env.SALMONLOOP_VERIFY_TIMEOUT_MS) || 120000,
  worktreePrepareTimeoutMs: Number(process.env.SALMONLOOP_WORKTREE_PREPARE_TIMEOUT_MS) || 600000,
  auditVerifyOutputMaxInlineChars: 4000,
  auditVerifyOutputPreviewHeadChars: 2000,
  auditVerifyOutputPreviewTailChars: 2000,
  auditToolSummaryMaxInlineChars: 4000,
  auditToolSummaryPreviewHeadChars: 2000,
  auditToolSummaryPreviewTailChars: 2000,

  // Concurrency
  maxConcurrentOperations: Number(process.env.SALMONLOOP_MAX_CONCURRENT) || 3,

  // Logging
  maxLogLength: 10000,

  // Monitoring
  maxErrorHistory: 10,

  // Tool execution
  defaultToolTimeoutMs: 30000,
  maxToolOutputBytes: 1048576,

  // Artifact storage (OS temp)
  artifactTtlMs: Number(process.env.SALMONLOOP_ARTIFACT_TTL_MS) || 7 * 24 * 60 * 60 * 1000, // 7d
  artifactMaxFiles: Number(process.env.SALMONLOOP_ARTIFACT_MAX_FILES) || 2000,
  artifactMaxTotalBytes:
    Number(process.env.SALMONLOOP_ARTIFACT_MAX_TOTAL_BYTES) || 200 * 1024 * 1024, // 200MB
  artifactGcIntervalMs: Number(process.env.SALMONLOOP_ARTIFACT_GC_INTERVAL_MS) || 60 * 1000, // 60s

  // Heuristics & Size Limits
  largeFileThresholdBytes: 10240,
  binaryCheckBufferSize: 8192,

  // Cache & Depth
  astCacheSize: 50,
  astCacheTTLMs: 60000,
  maxDependencyDepth: 3,

  // Git timeout
  gitTimeoutMs: 15000,
  gitKillGraceMs: Number(process.env.SALMONLOOP_GIT_KILL_GRACE_MS) || 8000,
  // Conservative cross-platform command line budget (Windows is ~32k).
  gitArgMaxChars: Number(process.env.SALMONLOOP_GIT_ARG_MAX_CHARS) || 30000,

  // Resource locking
  lockWaitTimeoutMs: 30000, // 30s wait before reporting timeout
  lockAcquireHardTimeoutMs: Number(process.env.SALMONLOOP_LOCK_ACQUIRE_HARD_TIMEOUT_MS) || 60000, // Includes hung IO protection
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
