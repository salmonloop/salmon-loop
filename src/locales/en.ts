export const en = {
  llm: {
    planEmpty: 'LLM returned empty response for plan',
    planInvalid: 'Invalid Plan structure: missing required fields',
    planParseFailed: (content: string, error: string) =>
      `Failed to parse LLM response as JSON: ${content}. Error: ${error}`,
    patchEmpty: (reason?: string) =>
      `LLM returned empty response for patch${reason ? ` (${reason})` : ''}`,
    deprecatedOpenaiAdapter:
      'The legacy OpenAILLM adapter is deprecated and is not usable in this build. Please use AiSdkLLM.',
  },

  llmErrors: {
    httpInvalidJson: 'LLM returned a malformed JSON response',
    httpAborted: 'LLM request was aborted',
    httpRequestFailed: 'LLM request failed',
  },

  prompts: {
    definitionHint: 'Definitions should be modified with extreme caution',
    referenceHint: 'References marked with ↗️ indicate usage locations',
    plan: (
      context: string,
      instruction: string,
      maxFilesChanged: number,
      lastError?: string,
    ) => `You are a code modification assistant. Please generate a detailed modification plan based on the following context and instruction.

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
- 'verify': A verification command (e.g., \`npm test\`) or a concise description of how to verify.
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
    timeout: (timeout: number) => `Git command timed out after ${timeout}ms`,
    securityViolation: (cmd: string) => `Security Violation: Command '${cmd}' is not a query.`,
    hashObjectFailed: 'hash-object failed',
    showFailed: (error: string) => `git show failed: ${error}`,
    mergeFileFailed: (error: string) => `git merge-file failed: ${error}`,
  },

  diff: {
    notUnifiedFormat: 'Patch is not in unified diff format',
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
    starting: '🚀 Starting salmon-loop...',
    preflightPassed: 'Environment safety validation completed',
    planFailed: (error: string) => `Plan failed: ${error}`,
    patchGenerationFailed: (error: string) => `Patch generation failed: ${error}`,
    patchApplyFailed: (error: string) => `Patch application failed: ${error}`,
    verificationFailed: (error: string) => `Verification failed: ${error}`,
    verificationFailedSummary: 'Verification failed',
    verificationPassed: 'Verification passed successfully',
    verificationSkipped: 'Skipped',
    success: 'Successfully completed',
    maxRetriesExceeded: (maxRetries: number, lastError?: string) =>
      `Exceeded maximum retries (${maxRetries}), last error: ${lastError}`,
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
    gitDiff: 'Git Diff:',
    stagedDiff: 'Staged Diff (Committed Intentions):',
    unstagedDiff: 'Unstaged Diff (Work in Progress):',
    untrackedFiles: 'Untracked Files (New Files):',
  },

  cli: {
    // Program description
    programDescription: 'A minimal viable loop for automated code patching',
    runDescription: 'Run the salmon-loop',
    contextDescription: 'Build and print the context prompt (no LLM call)',

    // Chat mode
    chatResumed: (name: string) => `✨ Resumed: ${name}`,
    chatLastUpdated: (time: string) => `   Last updated: ${time}`,
    chatIterations: (count: number) => `   Iterations: ${count}`,
    chatNoPreviousSession: 'No previous session found. Starting new one.',
    chatNewSession: (id: string) => `🚀 New session: ${id}`,
    chatCommands: 'Commands:',
    chatCommandExit: '  /exit, /quit  - Exit chat (or Ctrl+C twice)',
    chatCommandStatus: '  /status       - Show session info',
    chatCommandClear: '  /clear        - Clear screen',
    chatCommandHistory: '  /history      - Show iteration history',
    chatSessionSaved: '👋 Session saved. Goodbye!',
    chatThinking: 'Thinking...',
    chatSuccess: (files: string) => `✅ Changes applied successfully!\n\nFiles changed: ${files}`,
    chatFailed: (reason: string) => `❌ Failed: ${reason}`,
    chatPrompt: 's8p>',
    chatExitHint: 'Press Ctrl+C again to exit',
    chatTaskInterrupted: '⚠️  Task interrupted by user (Ctrl+C)',

    gui: {
      recentLogs: 'Recent Logs',
      phase: 'Phase',
    },

    // Command descriptions
    commandExit: 'Exit the application',
    commandStatus: 'Show current session status',
    commandClear: 'Clear the screen/context',
    commandHistory: 'Show session history',

    // Option descriptions
    instructionOption: 'Instruction for code modification (required)',
    verifyOption: 'Verification command to run (e.g., "npm test") (required)',
    configOption: 'Path to SalmonLoop config JSON (default: <repo>/.salmonloop/config/config.json)',
    noConfigFileOption: 'Disable loading config file from the repository',
    printConfigOption: 'Print the resolved config (redacted) and exit',
    repoOption: 'Repository path (default: current directory)',
    fileOption: 'Target file path (relative to repo)',
    selectionOption: 'Direct text selection (mutually exclusive with --file)',
    dryRunOption: 'Generate patch without applying',
    verboseOption: 'Enable verbose logging (basic, extended)',
    forceResetOption: 'Force hard reset on failure (use with caution)',
    validateOption: 'Run code quality checks (lint and tests)',
    checkpointStrategyOption: 'Checkpoint strategy to use (direct, worktree)',
    applyBackOnDirtyOption: 'Behavior when apply-back detects a dirty workspace (3way, abort)',
    worktreePrepareOption: 'Optional setup command to run inside worktree',
    streamOutputOption: 'Stream LLM responses to the CLI as they arrive (best effort)',
    contextDiffScopeOption: 'Diff scope for context (primary, ast_related)',
    contextBudgetCharsOption: 'Context budget in characters (e.g., 30000)',

    // Error messages
    fileSelectionConflict: '--file and --selection are mutually exclusive',
    instructionRequired: '--instruction is required',
    verifyRequired: '--verify is required',
    contextInvalidDiffScope: (scope: string) =>
      `Invalid --diff-scope "${scope}". Expected "primary" or "ast_related".`,
    contextInvalidBudgetChars: (value: string) => `Invalid --budget-chars "${value}".`,
    apiKeyMissing:
      '⚠️  SALMONLOOP_API_KEY not found, using StubLLM. Set SALMONLOOP_API_KEY (or legacy S8P_API_KEY) to use a real LLM.',
    providerNotSupported: (type: string) =>
      `⚠️  Provider "${type}" is not supported yet. Falling back to StubLLM.`,
    clientPackageNotSupported: (pkg: string) =>
      `⚠️  LLM client.package "${pkg}" is not supported. Falling back to the default client.`,

    // Startup information
    starting: '🚀 Starting salmon-loop...',
    runningWith: 'Running salmon-loop with:',
    scope: (scope: string) => `  Scope: ${scope}`,
    verify: (command: string) => `  Verify: ${command}`,
    instruction: (instruction: string) => `  Instruction: ${instruction}`,
    repoPath: (path: string) => `  Repo path: ${path}`,
    configPath: (path: string) => `  Config file: ${path}`,
    contextFile: (file: string) => `  Context file: ${file}`,
    contextSelection: (length: number) => `  Context selection length: ${length}`,
    dryRunEnabled: '  Dry-run mode enabled',
    target: (path: string) => `  Target: ${path}`,

    // Result output
    result: '📊 Result:',
    operationSuccess: '\n✅ Operation completed successfully!',
    operationFailed: '\n❌ Operation failed.',
    success: (success: boolean) => `  Success: ${success}`,
    reason: (reason: string) => `  Reason: ${reason}`,
    attempts: (attempts: number) => `  Attempts: ${attempts}`,
    errorCode: (code: string) => `  Error code: ${code}`,
    auditPath: (path: string) => `  Audit log: ${path}`,
    diffMeta: (files: number, lines: number) => `  Diff: ${files} files changed, ${lines} lines.`,
    retry: (from: number, to: number, reason: string) =>
      `\nRetrying (${from} -> ${to}). Reason: ${reason}`,
    contextBuilt: (usedChars: number, truncated: boolean) =>
      `Context built (${usedChars} chars, truncated=${truncated})`,

    // Step logs
    stepLogs: '📝 Step Logs:',
    stepEntry: (index: number, step: string, success: boolean) =>
      `  ${index + 1}. ${step}: ${success ? '✅' : '❌'}`,
    stepError: (error: string) => `     Error: ${error}`,
    stepOutput: (output: string, maxLen: number) => {
      const truncated = output.length > maxLen;
      return `     Output: ${output.substring(0, maxLen)}${truncated ? '...' : ''}`;
    },

    rawPatch: (patch: string) => `  [DEBUG] Raw Patch:\n${patch}`,

    // Patch output
    finalPatch: '📄 Final Patch:',

    // Errors
    error: (error: string) => `❌ Error: ${error}`,
    unexpectedError: (error: string) => `Unexpected error: ${error}`,
    targetNodeOption: 'The name of the node (e.g., function name) that is allowed to be modified',
    runningValidation: '🔍 Running validation checks...',
    runningEslint: '  Running ESLint...',
    runningTests: '  Running Tests...',
    testsFailedContinuing: '  ⚠️ Tests failed, but continuing validation...',
    validationCompleted: '✅ Validation completed!',
    validationFailed: '❌ Validation failed.',
    optionsRequired:
      'Error: --instruction is required. --verify is required unless provided by config, or --validate is used.',

    // Snapshot management
    snapshotManageDescription: 'Manage snapshots',
    restoreDescription: 'Restore the workspace to a specific snapshot',
    restoreForceOption: 'Overwrite uncommitted changes',
    restoreStarting: (hash: string) => `Restoring snapshot ${hash}...`,
    restoreSuccess: (hash: string) => `Successfully restored snapshot ${hash}`,
    restoreFailedDirty: 'Restore failed: Workspace has uncommitted changes.',
    restoreFailedDirtyHint: 'Use --force to overwrite them, or commit/stash your changes first.',
    restoreFailed: (error: string) => `Restore failed: ${error}`,
    listSnapshotsDescription: 'List all available snapshots',
    createSnapshotDescription: 'Create a new snapshot of the current workspace',
    createSnapshotMessageOption: 'Description message for the snapshot',
    createSnapshotIncludeOption: 'Specific files to include in the snapshot',
    showSnapshotDescription: 'Show details and differences of a specific snapshot',
    showSnapshotFilesOption: 'List all files included in the snapshot',
    noSnapshots: 'No snapshots found.',
    availableSnapshots: 'Available Snapshots:',
    snapshotTableHead: 'Hash     Timestamp                  Message',
    autoSnapshotMsg: (hash: string) => `Auto-snapshot (staged: ${hash})`,
    snapshotCreated: (hash: string) => `Snapshot created: ${hash}`,
    snapshotMessage: (msg: string) => `Message: ${msg}`,
    snapshotCreateFailed: (error: string) => `Failed to create snapshot: ${error}`,
    snapshotDetails: (hash: string) => `Snapshot ${hash} Details:`,
    stagedFiles: 'Staged Files:',
    noStagedFiles: 'No staged files.',
    unstagedChanges: 'Unstaged Changes:',
    noUnstagedChanges: 'No unstaged changes.',
    allFilesInSnapshot: 'All Files in Snapshot:',
    snapshotShowFailed: (error: string) => `Failed to show snapshot: ${error}`,
    noDifferences: 'No differences found.',
    getDiffFailed: (error: string) => `Failed to get diff: ${error}`,
    readFileFailed: (error: string) => `Failed to read file: ${error}`,
    exportStarting: (hash: string, dir: string) => `Exporting snapshot ${hash} to ${dir}...`,
    exportSuccess: (hash: string) => `Successfully exported snapshot ${hash}`,
    exportFailed: (error: string) => `Failed to export snapshot: ${error}`,
    snapshotDeleted: (hash: string) => `Snapshot ${hash} deleted.`,
    snapshotDeleteFailed: (error: string) => `Failed to delete snapshot: ${error}`,
    clearForcePrompt: 'Please use --force to clear all snapshots.',
    allSnapshotsCleared: 'All snapshots cleared.',
    clearSnapshotsFailed: (error: string) => `Failed to clear snapshots: ${error}`,
    diffSnapshotDescription: 'Show diff between snapshots or workspace',
    diffSnapshotCodeOption: 'Show full code diff instead of summary',
    catSnapshotDescription: 'View file content from a snapshot',
    exportSnapshotDescription: 'Export snapshot content to a directory',
    deleteSnapshotDescription: 'Delete a snapshot',
    clearSnapshotsDescription: 'Clear all snapshots',
    clearSnapshotsForceOption: 'Force clear without confirmation',
  },

  config: {
    loadFailed: (error: string) => `Failed to load config: ${error}`,
    error: (code: string, details?: Record<string, string>) => {
      const detailStr = details ? ` Details: ${JSON.stringify(details)}` : '';

      switch (code) {
        case 'CONFIG_FILE_NOT_FOUND':
          return `Config file not found: ${details?.path || '(unknown path)'}`;
        case 'CONFIG_PARSE_FAILED':
          return `Failed to parse config JSON: ${details?.path || '(unknown path)'}`;
        case 'CONFIG_INVALID_ROOT':
          return 'Config file must be a JSON object';
        case 'CONFIG_UNSUPPORTED':
          return `Unsupported config version: ${details?.version || '(unknown version)'}`;
        case 'CONFIG_LLM_ACTIVE_PROVIDER_NOT_FOUND':
          return `Active LLM provider not found: ${details?.provider || '(unknown provider)'}`;
        case 'CONFIG_LLM_DEFAULT_MODEL_REQUIRED':
          return `LLM provider must define models.default: ${details?.provider || '(unknown provider)'}`;
        default:
          return `Invalid config (${code}).${detailStr}`;
      }
    },
  },

  // Progress bar and interactive feedback
  progress: {
    preflight: 'Preflight checks',
    context: 'Gathering context',
    plan: 'Creating plan',
    patch: 'Generating patch',
    validate: 'Validating patch',
    ast_validate: 'Validating AST',
    apply: 'Applying patch',
    verify: 'Verifying changes',
    rollback: 'Rolling back changes',
    shrink: 'Shrinking context',
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

  resource: {
    lockAcquireTimeout: (file: string) => `Timeout acquiring lock for file: ${file}`,
    lockReleaseFailed: (file: string) => `Failed to release lock for file: ${file}`,
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
    gitStatusDescription: 'Show the working tree status',
    gitCatDescription: 'Read file content from a specific git revision',
    codeAstDescription: 'Query AST definitions and references for symbols',
    testRunDescription: 'Run verification command (test/lint/build) and classify errors',

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
    audit: {
      saved: (file: string) => `[Audit] Saved structured audit log to ${file}`,
      failed: (error: string) => `[Audit] Failed to save audit log: ${error}`,
    },
    errors: {
      workerNotFound: (id: string) => `Worker "${id}" not found`,
      noWorkerSelected: 'No worker selected',
      aborted: 'Operation aborted by strategy',
      mergeFailed: (err: string) => `Merge execution failed: ${err}`,
      unexpectedException: (err: string) => `Unexpected execution exception: ${err}`,
    },
  },

  // Symbols for UI feedback
  symbols: {
    suggestion: '💡',
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
    rocket: '🚀',
    document: '📄',
    magnifier: '🔍',
    pen: '📝',
    chart: '📊',
  },
};
