export const en = {
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
  chatCommandClear: '  /new          - Start a new session and clear context (clear)',
  chatCommandHistory: '  /history      - Show iteration history',
  chatCommandQueue: '  /queue        - Manage the chat queue',
  chatCommandAuth: '  /auth         - Manage tool authorization',
  chatSessionSaved: '👋 Session saved. Goodbye!',
  chatThinking: 'Thinking...',
  chatSuccess: (files: string) => `✅ Changes applied successfully!\n\nFiles changed: ${files}`,
  chatFailed: (reason: string) => `❌ Failed: ${reason}`,
  chatPrompt: 's8p>',
  chatExitHint: 'Press Ctrl+C again to exit',
  chatTaskInterrupted: '⚠️  Task interrupted by user (Ctrl+C)',
  unknownCommand: (cmd: string) => `Unknown command: ${cmd}. Type /help for available commands.`,

  gui: {
    title: 'Salmon Loop',
    recentLogs: 'Recent Logs',
    phase: 'Phase',
    status: 'Status',
    initializing: 'Initializing GUI...',
    exitMessage: 'Exiting Salmon Loop...',
    processing: 'Processing flow...',
    inputPlaceholder: 'Type your instruction...',
    backHint: 'Press ESC to back',
    exitConfirmHint: 'Exit Salmonloop? (y/N)',
    renderError: 'Error rendering content',
    scrollHint: (current: number, total: number) => `(Scroll for more: ${current}/${total})`,
    confirmationTitle: '⚠️  Action Required',
    confirmationChallenge: (challenge: string) => `Enter [${challenge}] to confirm (Esc to cancel)`,
    highRiskWarning:
      'This operation involves physical code restoration. Please enter the validation code to continue.',
    authorizationTitle: '⚠️  Authorization Required',
    authorizationWarning:
      'This tool call has side effects. Enter the authorization code to allow it once.',
    authorizationHint: 'Tip: add "all", "save", or "global" after the code.',
    selectionPlaceholder: 'Use Up/Down to select, Enter to confirm (Esc to cancel)',
    selectionHint: 'Use Up/Down to navigate, Enter to select, Esc to cancel.',
  },

  // Command descriptions
  commandExit: 'Exit the application',
  commandStatus: 'Show current session status',
  commandClear: 'Start a new session and clear context (clear)',
  commandHistory: 'Show session history',
  commandSessions: 'List all chat sessions',
  commandQueue: 'Manage the chat queue',
  commandAuth: 'Manage tool authorization',
  commandParallel: 'Manage parallel plans',
  queueUsage: 'Usage: /queue <status|pause|resume|retry|clear>',
  queueUnavailable: 'Queue controls are not available in this mode.',
  queuePaused: 'Queue paused. Use /queue resume or /queue retry to continue.',
  queuePausedAfterInterrupt:
    'Queue paused after interrupt. Use /queue resume or /queue retry to continue.',
  queueAlreadyPaused: 'Queue is already paused.',
  queueNotPaused: 'Queue is not paused.',
  queueResumed: 'Queue resumed.',
  queueCleared: 'Queue cleared.',
  queueClearedCount: (count: number) => `Queue cleared. Dropped ${count} pending task(s).`,
  queueRetryQueued: 'Re-queued the interrupted task at the front of the queue.',
  queueRetryMissing: 'No interrupted task to retry.',
  queueInterruptedHint: 'Interrupted task detected. Use /queue retry to re-run it.',
  queueSubcommandHint: (sub: string) => `Queue ${sub} command`,
  queueStatus: (pending: number, processing: boolean, paused: boolean, interrupted: boolean) =>
    `Queue status: pending=${pending}, processing=${processing}, paused=${paused}, interrupted=${interrupted}`,
  authUsage:
    'Usage: /auth <list|add|remove|clear|hash|reload> [scope] [tool] [phase] [args=<hash>] [effects=a,b] [deny]',
  authSubcommandHint: (sub: string) => `Authorization ${sub} command`,
  parallelSubcommandHint: (sub: string) => `Parallel ${sub} command`,
  authScopeHint: (scope: string) => `Use ${scope} allowlist`,
  authPhaseHint: (phase: string) => `Phase ${phase.toUpperCase()}`,
  authToolNameHint: 'Known tool name',
  authConfigMissing: 'Authorization config is unavailable.',
  authHashUsage: 'Usage: /auth hash <json-or-string>',
  authHashResult: (hash: string) => `Args hash: ${hash}`,
  authListEmpty: (scope: string) => `No allowlist entries for ${scope}.`,
  authListEntry: (
    tool: string,
    mode: string,
    phase?: string,
    argsHash?: string,
    effects?: string[],
  ) => {
    const phaseText = phase ? ` phase=${phase}` : '';
    const hashText = argsHash ? ` args=${argsHash}` : '';
    const effectsText = effects && effects.length > 0 ? ` effects=${effects.join(',')}` : '';
    return `${tool} mode=${mode}${phaseText}${hashText}${effectsText}`;
  },
  authCleared: (scope: string) => `Cleared ${scope} allowlist.`,
  authAdded: (tool: string, scope: string, mode: string) =>
    `Added ${tool} to ${scope} allowlist (mode=${mode}).`,
  authRemoved: (tool: string, scope: string) => `Removed ${tool} from ${scope} allowlist.`,
  authRemoveMissing: (tool: string, scope: string) =>
    `No matching allowlist entry for ${tool} in ${scope}.`,
  authAddUsage: 'Usage: /auth add <scope> <tool> [phase] [args=<hash>] [effects=a,b] [deny]',
  authRemoveUsage: 'Usage: /auth remove <scope> <tool> [phase] [args=<hash>] [effects=a,b]',
  authCacheCleared: 'Authorization allowlist cache cleared.',
  authCacheInvalidated: (reason: string, path: string) =>
    `Authorization allowlist cache invalidated: ${reason} (${path})`,
  authPathBlocked: (path: string, scope: string) =>
    `Blocked allowlist path outside ${scope} scope: ${path}`,
  authToolRegistryUnavailable: 'Tool registry is unavailable. Try again later.',
  authInvalidToolName: (tool: string) => `Unknown tool name: ${tool}.`,
  authInvalidSideEffects: (effects: string) => `Invalid side effects: ${effects}.`,
  authLockTimeout: (path: string) => `Authorization allowlist lock timeout: ${path}`,
  authInvalidPhase: (phase: string) => `Invalid phase: ${phase}.`,
  parallelUsage: 'Usage: /parallel <list|resume|delete> [planId]',
  parallelListEmpty: 'No pending or blocked parallel plans found.',
  parallelSelectTitle: 'Select a parallel plan',
  parallelCanceled: 'Selection canceled.',
  parallelNotFound: (id: string) => `Parallel plan not found: ${id}.`,
  parallelResumed: (id: string, blocked: number, failed: boolean) =>
    `Parallel plan resumed: ${id} (blocked=${blocked}, failed=${failed})`,
  parallelDeleted: (id: string) => `Parallel plan deleted: ${id}.`,
  toolAuthorizationPrompt: (tool: string, risk: string, effects: string, summary: string) =>
    `Authorize tool call: ${tool} (risk=${risk}, effects=${effects})\nArgs: ${summary}\nUse code alone to allow once, append "all" for this session, "save" to persist in repo, or "global" to persist for this user.`,
  toolAuthorizationMissingUi: 'Authorization UI is unavailable. Tool call denied.',
  toolAuthorizationDenied: 'Tool call denied by user authorization.',
  toolAuthorizationApproved: 'Tool call authorized by user.',
  toolAuthorizationTerminalQuestion:
    'Authorize this tool call? (y=once, a=session, s=save repo, g=save user, n=deny)',
  toolAuthorizationAutoApproved: (tool: string, risk: string) =>
    `Auto-approved tool call: ${tool} (risk=${risk}).`,
  toolAuthorizationAllowlisted: (tool: string) => `Allowlist approved tool call: ${tool}.`,
  toolAuthorizationDenylisted: (tool: string) => `Denylist blocked tool call: ${tool}.`,

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

  // Resource and Workspace messages
  resource: {
    worktreeSkipCleanup: 'workPath equals baseRepoPath; skipping cleanup to avoid data loss',
    lockTimeoutAttemptForce: (path: string) =>
      `Lock acquisition timeout for ${path}, attempting force cleanup...`,
    lockForceRemoved: (file: string) => `Forcefully removed stale lock file: ${file}`,
    lockAcquiredAfterForce: (file: string) => `Lock acquired after force cleanup: ${file}`,
    lockAcquireTimeout: (path: string) => `Failed to acquire lock for ${path} within timeout`,
    lockReleaseFailed: (path: string) => `Failed to release lock for ${path}`,
  },

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
  verifyOutputArtifact: (handle: string) =>
    `  Verification output saved as ${handle} (use artifact.read to inspect)`,
  authorizationSummary: (summary: string) => `  Authorization sources: ${summary}`,
  authorizationSummaryRealtime: (summary: string) =>
    `  Authorization sources (current): ${summary}`,
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
  noSessionsFound: 'No saved sessions found.',
  sessionsHeader: 'Available Sessions:',
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
};
