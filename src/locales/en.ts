export const en = {
  llm: {
    planEmpty: 'LLM returned empty response for plan',
    planInvalid: 'Invalid Plan structure: missing required fields',
    planInvalidJson: 'LLM returned invalid JSON for plan',
    planParseFailed: (content: string, error: string) => {
      const raw = String(content ?? '');
      const max = 800;
      const preview = raw.length <= max ? raw : `${raw.slice(0, max)}…[truncated]…`;
      return `Failed to parse LLM response as JSON: ${preview}. Error: ${error}`;
    },
    patchEmpty: (reason?: string) =>
      `LLM returned empty response for patch${reason ? ` (${reason})` : ''}`,
    patchNotUnifiedDiff: 'LLM patch is not in unified diff format',
    patchInvalid: 'LLM patch is invalid',
    reviewEmpty: 'LLM returned empty response for review',
    validationFailed:
      'Tool output validation failed. The output does not match the expected schema.',
  },

  llmErrors: {
    httpResponseInvalidJson: 'LLM returned an invalid JSON response',
    httpInvalidJson: 'LLM returned a malformed JSON response',
    httpAborted: 'LLM request was aborted',
    httpRequestFailed: 'LLM request failed',
  },

  errors: {
    technicalDetailsHidden:
      'Technical details were hidden for safety. See the audit log for more information.',
    noFilesRead: 'No files were read during exploration. Open target files and retry.',
    explorationHallucination:
      'Exploration found candidate files but did not read them. Open target files and retry.',
    preflightNotGit: 'Preflight failed: not a git repository.',
    preflightDirty: 'Preflight failed: workspace has uncommitted changes.',
    applyBackFailed: 'Apply-back failed due to conflicting local changes.',
    patchNotApplicable: 'Patch could not be applied cleanly.',
    diffValidationFailed: 'Diff validation failed.',
    gitError: 'Git operation failed.',
    schemaInvalid: 'Structured output schema is invalid.',
    schemaValidationFailed: 'Structured output validation failed.',
    schemaViolation: 'Tool output schema violation detected.',
    usageError: 'Usage error: invalid command options.',
    interruptRequired: 'Input required to continue.',
    permissionRuleDeny: 'Permission denied by policy.',
    permissionRequiredContextCacheOutsideRoot:
      'Permission required: context cache outside repository root.',
    permissionDeniedContextCacheOutsideRoot:
      'Permission denied: context cache outside repository root.',
    compilationFailed: 'Compilation failed.',
    lintFailed: 'Linting failed.',
    testFailed: 'Tests failed.',
    logicFailed: 'Verification failed.',
    dependencyError: 'Dependency setup failed in the verification environment.',
    resourceLockError: 'Resource lock error during verification.',
    astValidationError: 'AST validation error.',
    unknownError: 'Unknown error.',
    timeout: 'Operation timed out.',
    runtimeError: 'Runtime error occurred.',
    toolParseError: 'Tool input could not be parsed.',
    outputParseFailed: 'Structured output could not be parsed.',
    authRequired: 'Authorization required to continue.',
    askUserCancelled: 'User input was cancelled.',
    askUserSubagentBlocked: 'User input blocked in sub-agent mode.',
    serializeError: 'Failed to serialize tool payload.',
    parseError: 'Failed to parse tool payload.',
    executionError: 'Tool execution failed.',
    invalidOutput: 'Tool output was invalid.',
    outputTruncated: 'Output was truncated.',
    pipelineRecoveryFailed: 'Pipeline recovery failed.',
    unknownSlash: 'Unknown slash command.',
    noSlashHandler: 'No handler available for the slash command.',
    internalError: 'Internal error occurred.',
    toolUnavailable: 'Required tool backend is unavailable.',
    nonzeroExit: 'Command failed with non-zero exit code.',
    toolNotFound: 'Tool not found.',
    malformedToolCall: 'Tool call was malformed.',
    invalidToolArguments: 'Tool arguments were invalid.',
    toolBudgetConcurrency: 'Tool call rejected due to concurrency budget.',
    toolCallBudgetExceeded: 'Tool call budget exceeded.',
    ppdToolResultMissing: 'Tool result is missing required payload.',
    technicalError: 'Technical error occurred.',
    usagePrintInstructionConflict:
      'Usage error: --print-instruction cannot be used with explicit instructions.',
    usageContinueResumeConflict: 'Usage error: --continue and --resume cannot be used together.',
    usageOutputProfileRequiresStreamJson:
      'Usage error: --output-profile requires --output-format stream-json.',
    usageInvalidOutputProfile: 'Usage error: invalid output profile.',
    usageJsonSchemaRequiresJson: 'Usage error: --json-schema requires --output-format json.',
    allowlistParseFailed: 'Allowlist parsing failed.',
    allowlistWriteFailed: 'Allowlist write failed.',
    allowlistCacheWriteFailed: 'Allowlist cache write failed.',
    allowlistLockTimeout: 'Allowlist lock acquisition timed out.',
    allowlistLockVerificationFailed: 'Allowlist lock verification failed.',
    allowlistAtomicWriteBackupFailed: 'Allowlist atomic write backup failed.',
    allowlistAtomicRestoreFailed: 'Allowlist atomic restore failed.',
    allowlistPathBlocked: 'Allowlist blocked the requested path.',
  },

  acp: {
    slashHelpDescription: 'Show available ACP slash commands',
    slashHelpResponse: (commands: string) => `Available commands: ${commands}`,
    slashUnknownCommand: (commandName: string) => `Unknown command: /${commandName}`,
    askUserHeader: 'User input required',
    askUserQuestion: (question: string) => `Question: ${question}`,
    askUserOptionsHeader: 'Options:',
    askUserOption: (label: string, description: string) => `- ${label}: ${description}`,
    askUserMultiSelectHint: 'Multi-select enabled (comma-separated answers)',
  },

  prompts: {
    definitionHint: 'Definitions should be modified with extreme caution',
    referenceHint: 'References marked with ↗️ indicate usage locations',
    plan: (context: string, instruction: string, maxFilesChanged: number, lastError?: string) =>
      `You are a code modification assistant. Please generate a detailed modification plan based on the following context and instruction.

# Context Hierarchy
- **Primary Text**: The ACTUAL content of the files. This is the only authoritative source for what lines exist.
- **Staged Diff**: Informational only. It may include changes that are NOT present in the working tree text you are patching.
- **Unstaged Diff**: Informational only. It may not fully reflect the working tree after retries.
- **Untracked Files**: New files that are not yet tracked by git.

# Context Data
${context}

# Instruction
${instruction}
${lastError ? `\n# Last Error\nThe previous attempt failed with the following error. Please adjust the plan to fix this issue:\n${lastError}\n` : ''}
# Requirements
- The plan must be in JSON format, containing exactly these fields: goal, files, changes, verify.
- 'goal': A brief, one-sentence description of the modification goal.
- 'files': An array of EXACT relative file paths that MUST be modified.
- 'changes': An array of strings, each clearly describing a specific logical change.
- 'verify': A verification command (e.g., \`pytest\`, \`go test ./...\`, or your project test command) or a concise description of how to verify.
- **Constraints**:
  - Maximum ${maxFilesChanged} files can be modified.
  - Do NOT generate any code blocks or implementation details here.
  - DO NOT include files that do not need changes.

Please return the plan in PURE JSON format without any additional text:`,

    patch: (
      plan: string,
      context: string,
      maxFilesChanged: number,
      maxDiffLines: number,
      lastError?: string,
    ) => {
      let targetFiles = '';
      try {
        const parsedPlan = JSON.parse(plan);
        if (parsedPlan.files && Array.isArray(parsedPlan.files)) {
          targetFiles = parsedPlan.files.join(', ');
        }
      } catch (__e) {
        // Fallback if plan is not valid JSON
      }

      return `You are a code modification assistant. Please generate a unified diff format patch based on the following plan and context.

# Context Hierarchy
- **Primary Text**: The ACTUAL content of the files. This is the absolute truth you must modify.
- **Staged Diff**: Represents committed intentions or baseline changes. Respect these as part of the established direction.
- **Unstaged Diff**: Shows recent work in progress. Do not revert or overwrite these changes unless explicitly instructed.
- **Untracked Files**: New files that are not yet tracked by git.

# Plan
${plan}

# Context Data
${context}
${targetFiles ? `\n# Target Files\n${targetFiles}\n` : ''}
${lastError ? `\n# Last Error\nThe previous attempt failed with the following error. Please fix the issue described:\n${lastError}\n` : ''}

# Bad Examples (REJECTED OUTPUT)
- **Adding explanations**: "Here is the diff you requested..."
- **Markdown blocks**: \`\`\`diff ... \`\`\`
- **Multiple versions**: Providing both the old and new file contents separately.
- **Partial fixes**: "I will fix the rest in the next step."

# Validation Checklist (BEFORE OUTPUT)
1. **Format**: Is it standard git unified diff (starting with \`diff --git\`)?
2. **Paths**: Do \`--- a/path\` and \`+++ b/path\` exactly match target files?
3. **Scope**: Does it only modify what's requested in the instruction?
4. **Context**: Are there 8-12 lines of EXACT surrounding context for each hunk?
5. **Cleanliness**: Is there ANY text other than the diff itself? (If yes, remove it).

# Requirements
- Must generate standard **git unified diff format**.
- **Output ONLY the final diff. Do NOT include any explanations, Markdown blocks, or commentary.**
- **If you need to fix an error, regenerate the ENTIRE diff correctly in one block.**
- **CRITICAL**: Use EXACT relative paths from the repository root in diff headers.
  - Example: \`--- a/src/index.js\` and \`+++ b/src/index.js\`
- **Context Matching**: Provide 8-12 lines of surrounding code.
  - Indentation and whitespace must match EXACTLY.
- **DO NOT include \`index <old>..<new>\` lines** (the host may strip them for safety).
- Constraints:
  - Maximum ${maxFilesChanged} files.
  - Maximum ${maxDiffLines} total diff lines.
  - No file creation, deletion, or renaming.
  - No unrelated refactoring or formatting.
  - **DO NOT translate or modify comments unless explicitly instructed.**

Please return the patch in PURE unified diff format:`;
    },
  },
  git: {
    applyFailed: (error: string) => `git apply failed: ${error}`,
    applySpawnFailed: (error: string) => `git apply spawn failed: ${error}`,
    processError: (error: string) => `Git process error: ${error}`,
    commandFailed: (code: number | null) => `Git command failed with code ${code}`,
    commandFailedDetailed: (code: number | null, stderr: string) =>
      `Git command failed with code ${code}${stderr ? `: ${stderr}` : ''}`,
    timeout: (timeout: number) => `Git command timed out after ${timeout}ms`,
    securityViolation: (cmd: string) =>
      `Security Violation: Git command '${cmd}' is not allowed via this gateway.`,
    hashObjectFailed: 'hash-object failed',
    showFailed: (error: string) => `git show failed: ${error}`,
    mergeFileFailed: (error: string) => `git merge-file failed: ${error}`,
    conflictResolutionDenied:
      'Conflict resolution denied: Cannot run destructive reset in non-shadow environment',
    indexWriteDenied: 'Index write denied: This operation is only allowed in a shadow worktree.',
    outputTruncated: (maxBytes: number) => `Git output truncated at ${maxBytes} bytes`,
  },

  diff: {
    notUnifiedFormat: 'Patch is not in unified diff format',
    patchDoesNotApply: (details?: string) =>
      `Patch does not apply cleanly to the current workspace${details ? `:\n${details}` : ''}`,
    tooManyFiles: (count: number, max: number, files?: string[]) =>
      `Patch affects ${count} files, but you can only modify up to ${max} files.${files ? ` (Files: ${files.join(', ')})` : ''}`,
    tooManyLines: (count: number, max: number) =>
      `Patch has ${count} diff lines, but the maximum allowed is ${max} lines.`,
    fileCreationNotAllowed: (file?: string) =>
      `File creation is not allowed in this mode${file ? `: ${file}` : ''}`,
    fileDeletionNotAllowed: (file?: string) =>
      `File deletion is not allowed in this mode${file ? `: ${file}` : ''}`,
    fileRenameNotAllowed: (from?: string, to?: string) =>
      `File renaming is not allowed in this mode${from && to ? `: ${from} -> ${to}` : ''}`,
    diffValidationFailed: (reason: string) => `Diff validation failed: ${reason}`,
  },

  loop: {
    starting: 'Starting salmon-loop...',
    preflightPassed: 'Environment safety validation completed',
    planFailed: (error: string) => `Plan failed: ${error}`,
    patchGenerationFailed: (error: string) => `Patch generation failed: ${error}`,
    patchApplyFailed: (error: string) => `Patch application failed: ${error}`,
    verificationFailed: (error: string) => `Verification failed: ${error}`,
    verificationFailedSummary: 'Verification failed',
    verificationPassed: 'Verification passed successfully',
    budgetStatusSummary: (
      avgUtilizationPercent: number,
      truncationRatePercent: number,
      successRatePercent: number,
      criticalDropRatePercent: number,
      sampleSize: number,
    ) =>
      `Budget status: utilization=${avgUtilizationPercent}% truncation=${truncationRatePercent}% success=${successRatePercent}% critical_drop=${criticalDropRatePercent}% samples=${sampleSize}`,
    verificationSkipped: 'Skipped',
    verificationOutputStored: (handle: string) =>
      `Verification output saved as artifact: ${handle}`,
    success: 'Successfully completed',
    maxRetriesExceeded: (maxRetries: number, lastError?: string) =>
      `Exceeded maximum retries (${maxRetries}), last error: ${lastError}`,
    retryingAttempt: (from: number, to: number, reason: string) =>
      `Retrying (${from} -> ${to}). Reason: ${reason}`,
    contextShrinking: 'Shrinking context and retrying...',
    rollbackAndShrink: 'Rolling back and shrinking context...',
    diffValidationPassed: 'Diff validation passed',
    patchValidationFailed: 'Patch validation failed',
    contextShrunk: 'Context shrunk for next attempt',
    patchApplied: 'Patch applied successfully',
    dryRunPatchNotApplied: 'Dry run - patch not applied',
    dryRunCompleted: 'Dry run completed: patch generated and validated, but not applied.',
    operationCompleted: 'Operation completed successfully',
    exceededMaxRetriesSimple: 'Exceeded maximum retry attempts',
    loopExecutionFailed: 'Loop execution failed',
    unexpectedTermination: 'Unexpected loop termination',
    rollbackFailed: (error: string) => `Rollback failed: ${error}`,
    rollbackCompleted: 'Rollback completed successfully',
    rollbackSkippedNoAnchor: 'Skipping rollback: No shadowInitialRef found',
    emergencyRollbackTriggered: 'Emergency rollback triggered due to pipeline failure',
    emergencyRollbackFailed: (error: string) => `Emergency rollback failed: ${error}`,
    rollbackFailedDirty:
      'Rollback failed; workspace may be dirty. Please run `git status` and manually reset using `git reset --hard`. If you are in a retry loop, you might need to manually clean up before the next attempt.',
    rollbackSuccess: (files: string[]) => `Successfully rolled back: ${files.join(', ')}`,
    rollbackAllSuccess: 'Successfully rolled back all changes using hard reset',
    preflightFailedNotGit: 'Preflight check failed: Not a git repository',
    preflightFailedDirty: (status: string) =>
      `Preflight check failed: Workspace has uncommitted changes. Please commit or stash them before running SalmonLoop.\n\nChanges:\n${status}`,
    gitNotFound:
      'Preflight check failed: git command not found. Please ensure git is installed and in your PATH.',
    preflightGitCheckFailed: (error: string) => `Preflight check failed: git error: ${error}`,
    preflightGitStatusFailed: (error: string) =>
      `Preflight check failed: git status error: ${error}`,
    forceResetNotAllowedWithDirty:
      'Safety Guard: --force-reset is not allowed when the workspace is dirty to prevent accidental loss of uncommitted changes.',
    workspaceInitFailed: 'Failed to initialize workspace',
    worktreeMetadataFailed: (error: string) => `Failed to capture worktree metadata: ${error}`,
    ignoringDirtyWorkspaceDebug: (reason: string) =>
      `Ignoring dirty workspace for worktree strategy: ${reason}`,
    worktreePrepareDebug: (command: string) => `Running worktree prepare command: ${command}`,
    worktreePrepareFailed: (output: string) => `Worktree prepare command failed: ${output}`,
    syncingDirtyWorkspace: 'Syncing dirty workspace changes to worktree...',
    noContextGathered: 'No relevant context could be gathered for the given instruction.',
    astValidationPassed: 'AST validation passed',
    astValidationFailed: (error: string) => `AST validation failed: ${error}`,
    astStructureError: (file: string, error: string) => `AST structure error in ${file}: ${error}`,
    astScopeIntegrityError: (file: string, reason: string) =>
      `AST scope integrity check failed for ${file}: ${reason}`,
    targetNodePlacementError: (file: string, reason: string) =>
      `Target node placement validation failed for ${file}: ${reason}`,
    skipPathDueToPolicy: (reason: string | undefined, file: string) =>
      `Skipping path ${file} due to policy: ${reason}`,
    skipFileDueToPolicy: (reason: string | undefined, file: string) =>
      `Skipping file ${file} due to policy: ${reason}`,
    skipMissingFileSync: (file: string) => `Skipping missing file during sync: ${file}`,
    // applyBack specific messages used by shadow-merge.ts
    skippedFiles: (files: string) => `[applyBack] Skipped files: ${files}`,
    removeMergeTempFailed: (path: string, error: string) =>
      `[applyBack] Failed to remove merge temp file ${path}: ${error}`,
    normalizingCrlf: '[applyBack] Normalizing CRLF line endings to LF for merge-file.',
    getStatusForPathRaw: (file: string) => `[getStatusForPath] Raw status for ${file}:`,
    getStatusForPathToken: (idx: number, code: string, hex0: string, hex1: string, full: string) =>
      `  Token ${idx}: code="${code}" (0x${hex0} 0x${hex1}), full="${full}"`,
    shadowDiffPreviewEngine: (file: string, lines: number, hunks: string) =>
      `[applyBack] Shadow diff for ${file}: ${lines} lines, hunks: ${hunks}`,
    shadowDiffPreviewFull: (preview: string) => `[applyBack] Shadow diff preview:\n${preview}`,
    appliedLineLocationsEngine: (file: string, locations: string) =>
      `[applyBack] Applied line locations for ${file}: ${locations}`,
    unionMergeWarning: (file: string) =>
      `[applyBack] Note: used union merge strategy for ignored file ${file}. Please check for duplicate keys.`,
    applyBackCompletedWithConflicts: (count: number, files: string) =>
      `Apply-back completed with conflicts in ${count} file(s): ${files}. Rejection files (.rej) have been generated.`,
    conflictGeneratedRejection: (file: string, path: string) =>
      `Conflict in ${file}, generated rejection file: ${path}`,
    failedToGenerateRejection: (file: string, error: string) =>
      `Failed to generate .rej file for ${file}: ${error}`,
    workspaceDirtyAbort: 'Workspace is dirty and applyBackOnDirty is set to abort',
    applyBackAbortedDirty: (status: string) =>
      `Apply-back aborted: main workspace has uncommitted changes.\n${status}`,
    promotingUnstagedChanges: (file: string) =>
      `[ShadowMergeEngine] File ${file} is in MM (Double Dirty) state. Promoting unstaged changes to index to resolve context dependency.`,
    skippingIgnoredFileOverwrite: (file: string) => `Skipping overwrite of ignored file: ${file}`,
    using3WayMergeStrategy:
      '[ShadowMergeEngine] Using 3-way merge strategy to preserve user changes in dirty workspace.',

    // Internal loop logs
    createdSafeSnapshot: (hash: string) => `Created safe snapshot: ${hash}`,
    snapshotCreateError: (error: string) => `Failed to create snapshot: ${error}`,
    recordInitialRefError: (error: string) => `Failed to record initial checkpoint ref: ${error}`,
    discoveryPhaseBanner:
      'You are in the CONTEXT DISCOVERY phase. Your goal is to gather information about the codebase to solve the task.',
    discoveryPhaseHint: 'You can use tools by wrapping them in <sl_tool_call v="1"> tags.',
    discoveryPhaseExample:
      'Example: <sl_tool_call v="1">{"toolName": "code.search", "args": {"pattern": "main"}}</sl_tool_call>',
    discoveryTask: (task: string) => `Task: ${task}`,
    discoveryVerify: (cmd: string) => `Verification Command: ${cmd}`,
    discoveryEmptyResponse: 'LLM returned empty response during context discovery',
    toolExecutionResult: (name: string, status: string) => `Tool execution [${name}]: ${status}`,
    astInitialFile: (file: string, nodes: string) =>
      `[AST] Initial File: ${file}, Top-level nodes: ${nodes}`,
    astTargetNodePlacement: (name: string, top: boolean) =>
      `[AST] Target node '${name}' at top-level: ${top}`,
    applyBackRollbackAttempt: 'Attempting to rollback main workspace changes...',
    applyBackRollbackSuccess: 'Main workspace rollback succeeded',
    applyBackRollbackError: (error: string) => `Main workspace rollback error: ${error}`,
    applyBackRollbackSkipped:
      'Apply-back failed before touching the main workspace. Rollback skipped.',
    applyBackStarted: (attempt: number) => `Apply-back started (attempt ${attempt})`,
    applyBackSucceeded: (attempt: number) =>
      `Apply-back completed successfully (attempt ${attempt})`,
    applyBackFailed: 'Failed to apply changes back to the main workspace.',
    applyBackFailedPrepare: 'Failed to prepare apply-back checkpoint in the shadow workspace.',
    applyBackFailedSync: 'Failed to sync verified changes back to the main workspace.',
    rollbackShadowRef: (ref: string) => `[ROLLBACK] Using shadowInitialRef: ${ref}`,
    applyBackDualMerge: (init: string, latest: string) =>
      `[applyBack] Using dual-merge apply-back (shadow refs: ${init} -> ${latest}).`,
    applyBackPatchStats: (chars: number, lines: number, binary: string) =>
      `[applyBack] Patch stats: ${chars} chars, ${lines} lines, binary: ${binary}`,
    applyBackNewline: (val: boolean) => `[applyBack] Patch ends with newline: ${val}`,
    applyBackPatchPreview: (lines: number, content: string, truncated: boolean) =>
      `[applyBack] Patch preview (first ${lines} lines):\n${content}${truncated ? '\n...[truncated]...' : ''}`,
    applyBackDebugPath: (path: string) => `[applyBack] Patch written to: ${path}`,
    applyBackDebugWriteError: (error: string) =>
      `[applyBack] Failed to write debug patch file: ${error}`,
    applyBackBaseMismatch: (base: string, head: string) =>
      `[applyBack] Patch base (${base}) differs from main HEAD (${head}); dropping index lines to avoid mismatch.`,
    applyBackDirtyDetected: (files: string) =>
      `[applyBack] Dirty workspace detected. Creating checkpoint for all dirty files. Overlap with patch: ${files}`,
    applyBackCheckpointCreated: () =>
      '[applyBack] Dirty workspace checkpoint created. See logs for location.',
    applyBackCheckpointLocation: (dir: string) =>
      `[applyBack] Dirty workspace checkpoint created at: ${dir}`,
    applyBackUntrackedIncluded: (files: string) =>
      `[applyBack] Checkpoint includes untracked files: ${files}`,
    checkpointLocation: (dir: string) => `Checkpoint location: ${dir}`,
    applyBackDirtyRestoreResult: (before: string, after: string) =>
      `[applyBack] Dirty workspace restore completed with status diff.\nBefore:\n${before}\nAfter:\n${after}`,
  },

  verify: {
    truncated: (maxLines: number) => `...[Output truncated, exceeds ${maxLines} lines]`,
    terminated: '\n[Process Terminated]',
    commandError: (command: string, error: string) =>
      `Failed to execute command: ${command}. Error: ${error}`,
    outputTruncated: (head: number, tail: number) =>
      `\n...[Output truncated, showing first ${head} and last ${tail} lines]...\n`,
    commandTimeout: 'Command timed out',
    failedToStartCommand: 'Failed to start command',
    verifyFileContentError: (file: string, error: string) =>
      `Error verifying file content for ${file}: ${error}`,
    worktreeStrategyActive:
      'Worktree strategy active: dirty state will be preserved in shadow worktree.',
    ripgrepNotFoundWarning: 'ripgrep (rg) not found. Context gathering may be limited.',
    autoDetected: (command: string) => `Auto-detected verification command: ${command}`,
    autoDetectedWorktreePrepare: (command: string) =>
      `Auto-detected worktree prepare command: ${command}`,
    noCommandFound: 'No verification command found. Verification will be skipped.',
    explicitlyDisabled: 'Verification explicitly disabled via --no-verify',
  },

  context: {
    contentTruncated: '...[Content truncated for context budget]...',
    ripgrepNotFound: 'Error: ripgrep (rg) not found in PATH. Context gathering may be incomplete.',
    ripgrepError: (error: string) => `Error running ripgrep: ${error}`,
    workingDirectory: 'Working Directory: . (Root of the repository)',
    primaryFile: (file: string) => `Primary File: ${file}`,
    primaryText: 'Primary Text:',
    relatedContext: 'Related Context (Imported Dependencies):',
    relatedFile: (file: string, mode: string) => `File: ${file} (mode=${mode})`,
    relatedContentTruncated: '...[Related file truncated for context budget]...',
    codeSnippets: 'Code Snippets:',
    snippetLocation: (file: string, line: number) => `File: ${file}:${line}`,
    initFailed: (error: string) => `Failed to initialize AST parser: ${error}`,
    loadLanguageFailed: (lang: string, error: string) =>
      `Failed to load language ${lang}: ${error}`,
    invalidStructure: 'AST structure validation failed: tree contains error nodes',
    scopeRemoved: (name: string) => `Top-level node '${name}' was removed.`,
    scopeModified: (name: string) =>
      `Top-level node '${name}' was modified but it was not the target.`,
    invalidTree: 'Invalid AST tree provided for validation',
    gitDiff: 'Git Diff:',
    stagedDiff: 'Staged Diff (Committed Intentions):',
    unstagedDiff: 'Unstaged Diff (Work in Progress):',
    untrackedFiles: 'Untracked Files (New Files):',
  },

  config: {
    loadFailed: (error: string) => `Failed to load config: ${error}`,
    error: (code: string, details?: Record<string, string>) => {
      const detailStr = details ? ` Details: ${JSON.stringify(details)}` : '';

      switch (code) {
        case 'CONFIG_FILE_NOT_FOUND':
          return `Config file not found: ${details?.path || '(unknown path)'}`;
        case 'CONFIG_PARSE_FAILED':
          return `Failed to parse config file: ${details?.path || '(unknown path)'}`;
        case 'CONFIG_INVALID_ROOT':
          return 'Config file must be a JSON object';
        case 'CONFIG_UNSUPPORTED':
          return `Unsupported config version: ${details?.version || '(unknown version)'}`;
        case 'CONFIG_LLM_ACTIVE_PROVIDER_NOT_FOUND':
          return `Active LLM provider not found: ${details?.provider || '(unknown provider)'}`;
        case 'CONFIG_LLM_DEFAULT_MODEL_REQUIRED':
          return `LLM provider must define models.default: ${details?.provider || '(unknown provider)'}`;
        case 'CONFIG_INVALID_OUTPUT':
          return 'Config output section must be a JSON object';
        case 'CONFIG_INVALID_OBSERVABILITY':
          return 'Config observability section must be a JSON object';
        case 'CONFIG_INVALID_OBSERVABILITY_LANGFUSE':
          return 'Config observability.langfuse must be a JSON object';
        case 'CONFIG_INVALID_LANGFUSE_ENABLED':
          return 'Config observability.langfuse.enabled must be a boolean';
        case 'CONFIG_INVALID_LANGFUSE_OUTCOME':
          return 'Config observability.langfuse.outcome must be a boolean';
        case 'CONFIG_INVALID_LANGFUSE_ENDPOINT':
          return 'Config observability.langfuse.endpoint must be a string';
        case 'CONFIG_INVALID_LANGFUSE_API_KEY':
          return 'Config observability.langfuse.apiKey must be a string or null';
        case 'CONFIG_INVALID_LANGFUSE_SESSION_ID':
          return 'Config observability.langfuse.sessionId must be a string';
        case 'CONFIG_INVALID_LANGFUSE_USER_ID':
          return 'Config observability.langfuse.userId must be a string';
        case 'CONFIG_INVALID_LLM_OUTPUT':
          return 'Config output.llm must be a JSON object';
        case 'CONFIG_INVALID_LLM_OUTPUT_KINDS':
          return 'Config output.llm.kinds must be an array of strings';
        case 'CONFIG_INVALID_LLM_OUTPUT_KIND':
          return `Config output.llm.kinds contains invalid value: ${
            details?.kind || '(unknown kind)'
          }`;
        case 'CONFIG_INVALID_OUTPUT_MARKDOWN':
          return 'Config output.markdown must be a JSON object';
        case 'CONFIG_INVALID_MARKDOWN_THEME':
          return `Config output.markdown.theme contains invalid value: ${
            details?.theme || '(unknown theme)'
          }`;
        case 'CONFIG_INVALID_MARKDOWN_RENDER_MODE':
          return `Config output.markdown.mode contains invalid value: ${
            details?.mode || '(unknown mode)'
          }`;
        case 'CONFIG_INVALID_UI':
          return 'Config ui section must be a JSON object';
        case 'CONFIG_INVALID_UI_LOG':
          return 'Config ui.log section must be a JSON object';
        case 'CONFIG_INVALID_UI_LOG_VIEW':
          return `Config ui.log.view contains invalid value: ${details?.view || '(unknown view)'}`;
        case 'CONFIG_INVALID_UI_LOG_MODE':
          return `Config ui.log.mode contains invalid value: ${details?.mode || '(unknown mode)'}`;
        case 'CONFIG_INVALID_AST_VALIDATION':
          return 'Config astValidation section must be a JSON object';
        case 'CONFIG_INVALID_AST_VALIDATION_STRICTNESS':
          return `Config astValidation.strictness contains invalid value: ${
            details?.strictness || '(unknown strictness)'
          }`;
        default:
          return `Invalid config (${code}).${detailStr}`;
      }
    },
  },

  // Progress bar and interactive feedback
  progress: {
    preflight: 'Preflight checks',
    prepare_deps: 'Preparing dependencies',
    context: 'Gathering context',
    explore: 'Exploring codebase',
    plan: 'Creating plan',
    patch: 'Generating patch',
    validate: 'Validating patch',
    ast_validate: 'Validating AST',
    apply: 'Applying patch',
    verify: 'Verifying changes',
    rollback: 'Rolling back changes',
    shrink: 'Shrinking context',
    review: 'Reviewing changes',
    report: 'Generating report',
    analyze_issues: 'Analyzing issues',
    waiting: 'Waiting for LLM...',
  },

  suggestions: {
    compilation: 'Check for syntax errors or missing imports.',
    lint: 'Run your linter locally to see detailed errors.',
    test: 'Check the test output above for specific failures.',
    dirty: 'Commit or stash your changes before running.',
    notGit: 'Initialize a git repository in the target directory.',
    rollbackFailed: 'Manual cleanup required. Run `git reset --hard HEAD`.',
    unknown: 'Check the logs above for more details.',
    gitError: 'Git operation failed. Run `git status` and resolve any conflicts.',
  },

  dependency: {
    versionMismatch: (dependency: string, expected: string, actual: string) =>
      `Dependency version mismatch: ${dependency} expected ${expected}, but got ${actual}`,
    versionMismatchHint: 'This may cause compatibility issues. Please update your dependencies.',
    checkFailed: 'Failed to check dependency versions',
    checkCompleted: 'Dependency version check completed',
  },

  ast: {
    degradedApi:
      'Using legacy tree-sitter API. Some features might be limited. Please consider upgrading web-tree-sitter.',
    initFailed: (error: string) => `Failed to initialize AST parser: ${error}`,
    loadLanguageFailed: (lang: string, error: string) =>
      `Failed to load language ${lang}: ${error}`,
    invalidStructure: 'AST structure validation failed: tree contains error nodes',
    scopeRemoved: (name: string) => `Top-level node '${name}' was removed.`,
    scopeModified: (name: string) =>
      `Top-level node '${name}' was modified but it was not the target.`,
    invalidTree: 'Invalid AST tree provided for validation',
  },

  monitor: {
    reportTitle: 'SalmonLoop Exception Analysis Report',
    totalErrors: (count: number) => `Total Errors Tracked: ${count}`,
    recentErrors: 'Recent Error History:',
    errorEntry: (timestamp: string, type: string, message: string) =>
      `[${timestamp}] ${type}: ${message}`,
    noErrors: 'No errors recorded.',
    memoryWarning: (used: string, threshold: string) =>
      `Memory usage warning: Heap used ${used}MB exceeds threshold ${threshold}MB.`,
    suggestingGc: 'Suggesting garbage collection...',
    metricsTitle: '=== Checkpoint & ApplyBack Metrics ===',
    checkpointCreation: '[Checkpoint Creation]',
    worktreeCleanup: '[Worktree Cleanup]',
    applyBackOps: '[ApplyBack Operations]',
    attempts: (count: number) => `  Attempts: ${count}`,
    failures: (count: number) => `  Failures: ${count}`,
    failureRate: (rate: string) => `  Failure Rate: ${rate}%`,
    avgDuration: (ms: string) => `  Avg Duration: ${ms}ms`,
    p50Duration: (ms: string) => `  P50 Duration: ${ms}ms`,
    p95Duration: (ms: string) => `  P95 Duration: ${ms}ms`,
  },

  capability: {
    noBackends: (capability: string) => `No backends available for capability: ${capability}`,
    allBackendsFailed: (capability: string) => `All backends failed for capability: ${capability}`,
    backendError: (backend: string, error: string) => `Backend '${backend}' failed: ${error}`,
    fallbackTriggered: (from: string, to: string, reason: string) =>
      `Automatically falling back from '${from}' to '${to}' due to: ${reason}`,
  },

  tools: {
    // Tool descriptions
    codeSearchDescription: 'Fast file pattern matching tool that works with any codebase size',
    fsReadDescription: 'Read the full content of a file from the repository',
    codeReadDescription: 'Read the full content of a source file from the repository',
    fsListDescription: 'List files and directories under a repository path',
    gitStatusDescription: 'Show the working tree status',
    gitCatDescription: 'Read file content from a specific git revision',
    codeAstDescription: 'Query AST definitions and references for symbols',
    testRunDescription: 'Run verification command (test/lint/build) and classify errors',
    shellExecDescription: 'Execute a shell command in an isolated workspace (slash-only)',
    artifactReadDescription: 'Read salmonloop (s8p) artifacts by handle',
    proposalApplyDescription: 'Apply a patch proposal artifact into the current shadow worktree',
    planInitDescription: 'Initialize a runtime Markdown plan file under .salmonloop/plans/',
    planReadDescription: 'Read a summarized view of the current runtime Markdown plan',
    planUpdateDescription: 'Update a plan step by stable sl:id with minimal in-place edits',
    askUserDescription: 'Ask the user a structured question and wait for input',

    // Execution logs
    executing: (name: string) => `Executing tool: ${name}...`,
    completed: (name: string) => `Tool ${name} completed.`,
    failed: (name: string, error: string) => `Tool ${name} failed: ${error}`,

    // Errors
    notFound: (name: string) => `Tool ${name} not found`,
    policyDeny: (reason: string) => `Tool execution denied: ${reason}`,
    inputSchema: (reason: string) => `Invalid tool input: ${reason}`,
    outputSchema: (reason: string) => `Invalid tool output: ${reason}`,
    timeout: (ms: number) => `Tool execution timed out after ${ms}ms`,
    outputTooLarge: (size: number, limit: number) =>
      `Tool output too large (${size} bytes). Limit is ${limit} bytes.`,
    concurrencyLimit: 'Too many concurrent tool calls',
    rateLimit: (phase: string) => `Rate limit exceeded for phase ${phase}`,
    worktreeRequired: 'Tool requires worktree isolation',
    applyForbidden: 'Tools are strictly forbidden in APPLY phase',
    networkDenied: 'Network access is denied by default policy',
    invalidRelativePath: (p: string) =>
      `Invalid file path: ${p}. Absolute paths and traversal are forbidden.`,
    artifactNotFound: (handle: string) => `Artifact not found: ${handle}`,
    permissionRuleDenied: (rule: string) => `Tool execution denied by permission rule: ${rule}`,
    permissionRulesRequired: () =>
      'Tool execution denied: no matching --allowedTools permission rule',
    permissionRulesParseFailed: (details: string) =>
      `Invalid permission rules: ${details || 'unknown error'}`,
    askUserRequired: 'User input required',
    askUserSubagentBlocked: 'User input is unavailable in sub-agent execution',
    askUserPromptDefault: 'User input required',
  },

  audit: {
    event: (type: string, name: string, status: string) => `[Audit] ${type} ${name}: ${status}`,
  },

  transaction: {
    log: (phase: string, msg: string) => `[${phase}] ${msg}`,
  },

  grizzco: {
    gitUserConfigMissing: 'Git user.name or user.email is not configured',
    remoteLocked: 'File is locked remotely (Mock Check)',
    stagedFileProtected: 'Staged file detected and protected (use --force)',
    binaryMmCannotBeMerged: 'Binary MM file cannot be merged',
    fileHasExistingConflict: 'File has existing conflict',
    unknownDataDependency: (key: string) => `Unknown data dependency: ${key}`,
    microOrchestratorLoopStuck: (path: string) => `MicroOrchestrator stuck in loop for ${path}`,
    planAborted: (path: string, reason: string) => `Plan aborted for ${path}: ${reason}`,
    executionFailed: (path: string, error: string) => `Execution failed for ${path}: ${error}`,
    transactionCompleted: (success: number, total: number) =>
      `Grizzco transaction completed: ${success}/${total} files processed`,
    workerNotFound: (id: string) => `Worker "${id}" not found`,
    noWorkerSelected: 'No worker selected',
    pipeline: {
      stepStarted: (name: string) => `[Pipeline] Step started: ${name}`,
      stepFinished: (name: string, duration: number) =>
        `[Pipeline] Step finished: ${name} (${duration}ms)`,
      stepFailed: (name: string, error: string) => `[Pipeline] Step failed: ${name} - ${error}`,
      recoveryTriggered: (name: string) => `[Pipeline] Triggering recovery for ${name}`,
      recoveryFailed: (name: string, error: string) =>
        `[Pipeline] Recovery failed for ${name}: ${error}`,
    },
    validation: {
      explorationHallucination:
        'Exploration found candidate files via search but did not read any content. This usually indicates hallucination.',
      noFilesRead:
        'No files were read during the exploration phase. Please ensure you actually read the files you intend to modify.',
      explorationSkipped: 'Exploration skipped (tools disabled or unavailable)',
      explorationFinished: (count: number) =>
        `Exploration finished. Added ${count} files to context.`,
    },
    audit: {
      saved: (file: string) => `[Audit] Saved structured audit log to ${file}`,
      failed: (error: string) => `[Audit] Failed to save audit log: ${error}`,
      appendFailed: (error: string) => `[Audit] Failed to append audit trail delta: ${error}`,
    },
    observability: {
      outcomeReporterFailed: (error: string) =>
        `[Observability] Outcome reporter failed (ignored): ${error}`,
    },
    langfuse: {
      outcomeReported: (traceId: string) => `[Langfuse] Outcome reported for trace ${traceId}`,
      outcomeReportFailed: (traceId: string) =>
        `[Langfuse] Failed to report outcome for trace ${traceId}`,
    },
    errors: {
      workerNotFound: (id: string) => `Worker "${id}" not found`,
      noWorkerSelected: 'No worker selected',
      aborted: 'Operation aborted by strategy',
      mergeFailed: (err: string) => `Merge execution failed: ${err}`,
      unexpectedException: (err: string) => `Unexpected execution exception: ${err}`,
      readOnlyFileSystem: (operation: string) =>
        `Read-only filesystem: ${operation} is not permitted in read-only modes.`,
      flowStrategyAlreadyRegistered: (mode: string) =>
        `Flow strategy "${mode}" is already registered.`,
      unknownFlowMode: (mode: string, available: string) =>
        `Unknown flow mode "${mode}". Available: ${available}.`,
    },
    review: {
      generated: 'Review generated.',
      header: 'Review suggestions:',
      empty: 'No review suggestions available.',
      suggestionItem: (index: number, type: string, content: string) =>
        `Suggestion ${index} (${type}): ${content}`,
      suggestionRaw: (content: string) => `Review output: ${content}`,
      issuesExtracted: (count: number) => `Identified ${count} issue(s) from review.`,
      fixPlanGenerated: 'Generated fix plan based on review feedback.',
    },
    research: {
      generated: 'Research generated.',
      header: 'Research summary:',
      empty: 'No research findings available.',
      summary: (content: string) => `Summary: ${content}`,
      findingItem: (index: number, summary: string, confidence?: number, uncertainty?: string) =>
        `Finding ${index}: ${summary}${
          typeof confidence === 'number' ? ` (confidence: ${confidence})` : ''
        }${uncertainty ? ` [uncertainty: ${uncertainty}]` : ''}`,
    },
  },

  skills: {
    maxRetriesExceeded: (id: string) =>
      `Max retries exceeded for skill: ${id}. Possible circular dependency in dynamic data.`,
  },

  // Symbols for UI feedback
  symbols: {
    suggestion: '[hint]',
    success: '[ok]',
    error: '[error]',
    info: '[info]',
    warning: '[warn]',
    rocket: '[run]',
    document: '[doc]',
    magnifier: '[search]',
    pen: '[log]',
    chart: '[result]',
  },

  ui: {
    status: {
      cleanup: 'cleanup',
      stopping: 'stopping',
    },
  },

  resource: {
    workspaceCleanupStarting: 'Cleaning workspace...',
    workspaceCleanupFinished: 'Workspace cleanup finished.',
    worktreeSkipCleanup: 'workPath equals baseRepoPath; skipping cleanup to avoid data loss',
    worktreeNotFoundInList: (path: string) => `Worktree not found in git worktree list: ${path}`,
    lockTimeoutAttemptForce: (path: string) =>
      `Lock acquisition timeout for ${path}, attempting force cleanup...`,
    lockForceRemoved: (file: string) => `Forcefully removed stale lock file: ${file}`,
    lockAcquiredAfterForce: (file: string) => `Lock acquired after force cleanup: ${file}`,
    lockAcquireTimeout: (path: string) => `Failed to acquire lock for ${path} within timeout`,
    lockAcquireHardTimeout: (path: string) =>
      `Failed to acquire lock for ${path} within hard timeout; the filesystem may be unresponsive.`,
    lockReleaseOwnershipUnknown: (path: string, error: string) =>
      `Refusing to release lock for ${path} because lock ownership could not be verified: ${error}`,
    lockReleaseFailed: (path: string) => `Failed to release lock for ${path}`,
  },
  smallfry: {
    status: {
      spawning: 'Spawning a hungry Smallfry to handle the heavy lifting...',
      thinking: 'Smallfry is flapping around the codebase...',
      working: 'Smallfry is diligently collecting golden eggs (results)...',
      submitting: 'Smallfry is jumping back to the basket with a report...',
      terminated: 'Smallfry has been recalled to Grizzco.',
    },
    errors: {
      budgetExceeded: (used: number, limit: number) =>
        `Smallfry splatted: Token budget exceeded (Used: ${used}, Limit: ${limit})`,
      timeout: 'Smallfry ran out of ink and has been dismissed.',
      capabilityDeny: (tool: string) =>
        `Access denied: This Smallfry isn't trained to use '${tool}'.`,
      profileNotFound: (agentRef: string) => `Smallfry profile not found: '${agentRef}'.`,
      recursionLimitExceeded: (depth: number, limit: number) =>
        `Smallfry recursion limit exceeded (Depth: ${depth}, Limit: ${limit}).`,
      dispatchMissingRuntimeLlm:
        'Smallfry dispatch failed: missing runtime LLM in tool context (host bug).',
      missionFailed: 'Smallfry mission failed.',
      missionFailedWithReason: (reason: string) => `Smallfry mission failed: ${reason}`,
    },
    ui: {
      spawnToolDescription:
        'Deploy a specialized Smallfry (sub-agent) for autonomous task execution.',
      progressTitle: (id: string) => `[Smallfry: ${id}]`,
    },
  },
};
