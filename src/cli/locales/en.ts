export const en = {
  // Program description
  programDescription: 'A minimal viable loop for automated code patching',
  runDescription: 'Run the salmon-loop',
  contextDescription: 'Build and print the context prompt (no LLM call)',
  serveDescription: 'Start the A2A + sidecar server',
  serveAcpDescription: 'Start the agent-client-protocol (ACP) stdio server only',
  noColorOption: 'Disable colored output in logs',

  // Chat mode
  chatResumed: (name: string) => `Resumed: ${name}`,
  chatLastUpdated: (time: string) => `   Last updated: ${time}`,
  chatIterations: (count: number) => `   Iterations: ${count}`,
  chatNoPreviousSession: 'No previous session found. Starting new one.',
  chatNewSession: (id: string) => `New session: ${id}`,
  chatCommands: 'Commands:',
  chatCommandExit: '  /exit, /quit  - Exit chat (or Ctrl+C twice)',
  chatCommandStatus: '  /status       - Show session info',
  chatCommandClear: '  /new          - Start a new session and clear context (clear)',
  chatCommandHistory: '  /history      - Show iteration history',
  chatCommandQueue: '  /queue        - Manage the chat queue',
  chatCommandAuth: '  /config allowlist - Manage tool allowlist',
  chatCommandMode: '  /mode         - Set permission mode (interactive/yolo)',
  chatCommandConfig:
    '  /config           - Settings (log-mode/view/output/allowlist/permission-mode)',
  chatSessionSaved: 'Session saved. Goodbye!',
  chatThinking: 'Thinking...',
  chatSuccess: (files: string) => `Changes applied successfully.\n\nFiles changed: ${files}`,
  chatNoChanges: 'Completed successfully. No files were changed.',
  chatReviewCompleted: 'Review completed successfully.',
  chatResearchCompleted: 'Research completed successfully.',
  chatFailed: (reason: string) => `Failed: ${reason}`,
  chatPrompt: 's8p>',
  chatExitHint: 'Press Ctrl+C again to exit',
  chatTaskInterrupted: '[WARN] Task interrupted by user (Ctrl+C)',
  chatIntentRouted: (intent: string, confidence: number, reason: string) =>
    `Intent routed: ${intent} (confidence=${confidence.toFixed(2)}) reason=${reason}`,
  chatAnswerEmpty: 'No answer produced.',
  unknownCommand: (cmd: string) => `Unknown command: ${cmd}. Type /help for available commands.`,
  helpAvailableCommands: (rows: string) => `Available Commands:\n${rows}`,
  programHelpFooter:
    '\nTips:\n  Use "s8p <command> --help" to see command-specific options.\n  In chat, type /help to list slash commands.',
  slashHandlerUnavailable: 'Command handler unavailable',
  slashInternalError: 'Internal error',
  skillNoPrompt: (id: string) => `Skill ${id} did not produce a prompt`,
  askUserCancelled: 'User cancelled input request',

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
    confirmationTitle: '[WARN] Action Required',
    confirmationChallenge: (challenge: string) => `Enter [${challenge}] to confirm (Esc to cancel)`,
    highRiskWarning:
      'This operation involves physical code restoration. Please enter the validation code to continue.',
    authorizationTitle: '[WARN] Authorization Required',
    authorizationWarning:
      'This tool call has side effects. Enter the authorization code to allow it once.',
    authorizationHint: 'Tip: add "all", "save", or "global" after the code.',
    selectionPlaceholder: 'Use Up/Down to select, Enter to confirm (Esc to cancel)',
    selectionHint: 'Use Up/Down to navigate, Enter to select, Esc to cancel.',
    selectionPlaceholderMulti: 'Use Up/Down, Space to toggle, Enter to confirm (Esc to cancel)',
    selectionHintMulti: 'Use Up/Down to navigate, Space to toggle, Enter to confirm.',
  },

  // Command descriptions
  commandExit: 'Exit the application',
  commandStatus: 'Show current session status',
  commandClear: 'Start a new session and clear context (clear)',
  commandHistory: 'Show session history',
  commandSessions: 'List all chat sessions',
  commandQueue: 'Manage the chat queue',
  commandLlmOutput: 'Set which LLM sections are shown in the UI (advanced)',
  commandMode: 'Set permission mode (interactive|yolo) and save to config',
  commandLogMode: 'Set UI verbosity (quiet|normal|debug) and save to config',
  commandConfig: 'Settings hub (mode, log-mode, view, output, allowlist)',
  commandAuth: 'Manage tool allowlist',
  commandParallel: 'Manage parallel plans',
  commandSubagent: 'Consult or dispatch a Smallfry (sub-agent)',
  subagentUsage: 'Usage: /smallfry <list|info|log|stop> [agentId] [tail=<n>]',
  subagentUnknownVerb: (verb: string) => `Unknown sub-agent verb: ${verb}.`,
  subagentMissingId: (verb: string) => `Specify a Smallfry ID for "${verb}".`,
  subagentNotFound: (id: string) => `Smallfry not found: ${id}.`,
  subagentListHeader: 'Smallfry agents:',
  subagentInfoHeader: (id: string) => `Smallfry info: ${id}`,
  subagentLogHeader: (id: string) => `Logs for ${id}:`,
  subagentStopRequested: (id: string) => `Stop requested for Smallfry ${id}.`,
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
  llmOutputSuggestion: (kind: string) => `Set LLM output to ${kind}`,
  queueStatus: (pending: number, processing: boolean, paused: boolean, interrupted: boolean) =>
    `Queue status: pending=${pending}, processing=${processing}, paused=${paused}, interrupted=${interrupted}`,
  llmOutputUsage: 'Usage: /output <none|all|review,assistant_message,plan,patch>',
  llmOutputCurrent: (kinds: string) => `Current LLM output kinds: ${kinds}`,
  llmOutputUpdated: (kinds: string) => `LLM output kinds updated: ${kinds}`,
  llmOutputUnavailable: 'LLM output configuration is unavailable in this mode.',
  llmOutputPersisted: (path: string) => `LLM output settings saved to ${path}`,
  llmOutputPersistFailed: (reason: string) => `Failed to save LLM output settings: ${reason}`,
  modeUsage: 'Usage: /mode <interactive|yolo>',
  modeSuggestion: (mode: string) => {
    if (mode === 'interactive') return 'Interactive permission checks and allowlist rules';
    if (mode === 'yolo') return 'Bypass prompts, allowlist, and permission rules';
    return `Set permission mode to ${mode}`;
  },
  modeCurrent: (mode: string) => `Current permission mode: ${mode}`,
  modeInvalid: (mode: string) => `Invalid mode: ${mode}. Expected one of: interactive, yolo.`,
  modeUpdated: (mode: string) => `Permission mode updated: ${mode}`,
  modePersisted: (path: string) => `Permission mode saved to ${path}`,
  modePersistFailed: (error: string) => `Failed to save permission mode: ${error}`,
  logModeUsage: 'Usage: /log-mode <quiet|normal|debug>',
  logModeSuggestion: (mode: string) => {
    if (mode === 'quiet') return 'Quiet: show errors only';
    if (mode === 'normal') return 'Normal: recommended (key steps + warnings/errors)';
    if (mode === 'debug') return 'Debug: verbose (all logs + tool details)';
    return `Set UI verbosity to ${mode}`;
  },
  logModeCurrent: (mode: string) => `Current UI verbosity: ${mode}`,
  logModeInvalid: (mode: string) =>
    `Invalid log mode: ${mode}. Expected one of: quiet, normal, debug.`,
  logModeUpdated: (mode: string) => `UI log mode updated: ${mode}`,
  logModePersisted: (path: string) => `UI log mode saved to ${path}`,
  logModePersistFailed: (error: string) => `Failed to save UI log mode: ${error}`,
  configUsage: [
    'Usage: /config <log-mode|view|output|allowlist|permission-mode>',
    'Subcommands: log-mode, view, output, allowlist, permission-mode',
  ].join('\n'),
  configUnknownSubcommand: (name: string) => `Unknown subcommand: ${name}`,
  configLogModeDescription: 'UI verbosity (quiet/normal/debug)',
  configLogModeUsage: 'Usage: /config log-mode <quiet|normal|debug>',
  configPermissionModeDescription: 'Permission mode (interactive/yolo)',
  configPermissionModeUsage: 'Usage: /config permission-mode <interactive|yolo>',
  configViewDescription: 'Set UI density (compact|standard|full) and save to config',
  configViewUsage: 'Usage: /config view <full|standard|compact>',
  configViewSuggestion: (view: string) => `Set UI density to ${view}`,
  configViewCurrent: (view: string) => `Current UI density: ${view}`,
  configViewInvalid: (view: string) =>
    `Invalid UI density: ${view}. Expected one of: full, standard, compact.`,
  configViewUpdated: (view: string) => `UI density updated: ${view}`,
  configViewPersisted: (path: string) => `UI density saved to ${path}`,
  configViewPersistFailed: (error: string) => `Failed to save UI density: ${error}`,
  configOutputDescription: 'Set which LLM sections are shown in the UI (advanced)',
  configOutputUsage: 'Usage: /config output <none|all|review,assistant_message,plan,patch>',
  configAllowlistDescription: 'Manage tool allowlist (repo/user)',
  a2aHostOption: 'A2A listen host (default: 127.0.0.1)',
  a2aPortOption: 'A2A listen port (default: 7431)',
  a2aTokenOption: 'Bearer token for A2A auth (repeatable)',
  acpStdioDisableOption: 'Disable agent-client-protocol (ACP) stdio server',
  sidecarSocketOption: 'UDS path for the sidecar UI server',
  sidecarAllowConditionalOption: 'Expose conditional sidecar routes (use with care)',
  acpStdioStarted: (port: string) => `ACP (agent-client-protocol) stdio enabled; port ${port}`,
  invalidA2APort: (value: string) => `Invalid A2A port: ${value}`,
  serveStarted: (host: string, port: number, socket: string) =>
    `A2A listening on ${host}:${port}; sidecar socket at ${socket}`,
  configAllowlistUsage:
    'Usage: /config allowlist <list|add|remove|clear|hash|reload> [scope] [tool] [phase] [args=<hash>] [effects=a,b] [deny]',
  authUsage:
    'Usage: /allowlist <list|add|remove|clear|hash|reload> [scope] [tool] [phase] [args=<hash>] [effects=a,b] [deny]',
  authSubcommandHint: (sub: string) => `Allowlist ${sub} command`,
  parallelSubcommandHint: (sub: string) => `Parallel ${sub} command`,
  subagentDescription:
    'Smallfry (sub-agent) commands are still experimental. Use the agent_dispatch tool or the CLI helpers to spawn a sub-agent from your plan.',
  authScopeHint: (scope: string) => `Use ${scope} allowlist`,
  authPhaseHint: (phase: string) => `Phase ${phase.toUpperCase()}`,
  authToolNameHint: 'Known tool name',
  authConfigMissing: 'Allowlist config is unavailable.',
  authHashUsage: 'Usage: /allowlist hash <json-or-string>',
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
  authAddUsage: 'Usage: /allowlist add <scope> <tool> [phase] [args=<hash>] [effects=a,b] [deny]',
  authRemoveUsage: 'Usage: /allowlist remove <scope> <tool> [phase] [args=<hash>] [effects=a,b]',
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
  toolAuthorizationNonInteractiveMisconfigured: (strategy: string) =>
    `Non-interactive authorization is misconfigured (${strategy}). Tool call denied.`,
  toolAuthorizationNonInteractiveFailed: (code: string) =>
    `Non-interactive authorization failed (${code}). Tool call denied.`,
  toolAuthorizationNonInteractiveUnsupported: (strategy: string) =>
    `Non-interactive authorization strategy is unsupported (${strategy}). Tool call denied.`,
  toolAuthorizationTerminalQuestion:
    'Authorize this tool call? (y=once, a=session, s=save repo, g=save user, n=deny)',
  toolAuthorizationAutoApproved: (tool: string, risk: string) =>
    `Auto-approved tool call: ${tool} (risk=${risk}).`,
  toolAuthorizationAllowlisted: (tool: string) => `Allowlist approved tool call: ${tool}.`,
  toolAuthorizationDenylisted: (tool: string) => `Denylist blocked tool call: ${tool}.`,

  // Option descriptions
  printOption:
    'Run non-interactively with the given instruction (shorthand for "run --instruction")',
  instructionOption: 'Instruction for code modification (required)',
  verifyOption:
    'Verification command to run (e.g., "pytest", "go test ./...", or your project test command) (required)',
  configOption:
    'Path to SalmonLoop config file (YAML/JSON). Default lookup: <repo>/.salmonloop/config/config.yaml, config.yml, config.json',
  noConfigFileOption: 'Disable loading config file from the repository',
  printConfigOption: 'Print the resolved config (redacted) and exit',
  repoOption: 'Repository path (default: current directory)',
  continueOption: 'Continue the most recent session in this repository',
  resumeOption: 'Resume a session by ID (supports short prefix)',
  fileOption: 'Target file path (relative to repo)',
  selectionOption: 'Direct text selection (mutually exclusive with --file)',
  allowedToolsOption:
    'Allow tool calls by permission rules (comma-separated, repeatable). Example: Bash(pytest *)',
  disallowedToolsOption:
    'Deny tool calls by permission rules (comma-separated, repeatable). Example: Bash(rm *)',
  dryRunOption: 'Generate patch without applying',
  verboseOption: 'Enable verbose logging (basic, extended)',
  forceResetOption: 'Force hard reset on failure (use with caution)',
  validateOption: 'Run code quality checks (lint and tests)',
  preflightPolicyOption:
    'Preflight policy (lenient: continue on test failure, strict: fail on test failure)',
  checkpointStrategyOption: 'Checkpoint strategy to use (direct, worktree)',
  permissionModeOption: 'Permission mode (interactive, yolo)',
  logModeOption: 'UI log mode (quiet, normal, debug)',
  environmentModeOption: 'Worktree environment mode (strict, parity)',
  applyBackOnDirtyOption: 'Behavior when apply-back detects a dirty workspace (3way, abort)',
  worktreePrepareOption: 'Optional setup command to run inside worktree',
  streamOutputOption: 'Stream LLM responses to the CLI as they arrive (best effort)',
  includePartialMessagesOption:
    'Include partial message streaming events in stream-json output (alias for --stream-output).',
  outputFormatOption: 'Output format (text, json, stream-json)',
  outputProfileOption:
    'Output profile for stream-json (native, anthropic, openai). Only valid with --output-format stream-json.',
  headlessIncludeToolInputOption:
    'Headless only: include (redacted) tool input in stream-json output. Only valid with --output-format stream-json.',
  headlessIncludeToolOutputOption:
    'Headless only: include tool output summary in stream-json output. Only valid with --output-format stream-json.',
  headlessIncludeAuthorizationDecisionsOption:
    'Headless only: include tool authorization decisions in headless output. Only valid with --output-format json or stream-json.',
  allowOutsideCacheRootOption:
    'Allow context cache persistent path outside configured allowed roots for this run only (high risk).',
  jsonSchemaOption:
    'JSON Schema for structured_output (file path or JSON string). Only valid with --output-format json.',
  llmOutputOption:
    'LLM output visibility (none, all, review, assistant_message, explore, research, plan, patch; comma-separated)',
  auditScopeOption: 'Audit log scope (repo, user)',
  contextDiffScopeOption: 'Diff scope for context (primary, ast_related)',
  contextBudgetCharsOption: 'Context budget in characters (e.g., 30000)',
  actModeOption: 'Flow mode to run (patch, review, debug, research, answer, autopilot)',

  // Error messages
  fileSelectionConflict: '--file and --selection are mutually exclusive',
  instructionRequired: '--instruction is required',
  verifyRequired: '--verify is required',
  printInstructionConflict: '--print and --instruction are mutually exclusive.',
  printCommandConflict: (cmd: string) =>
    `--print can only be used with the "run" command (got: ${cmd}).`,
  jsonSchemaRequiresJsonOutput:
    '--json-schema is only valid when --output-format is set to "json".',
  jsonSchemaLoadFailed: (msg: string) => `Failed to load JSON schema: ${msg}.`,
  structuredOutputSchemaFailed: 'Structured output failed schema validation.',
  invalidActMode: (mode: string) =>
    `Invalid --act-mode "${mode}". Expected "patch", "review", "debug", "research", "answer", or "autopilot".`,
  invalidEnvironmentMode: (mode: string) =>
    `Invalid --environment-mode "${mode}". Expected "strict" or "parity".`,
  invalidOutputFormat: (format: string) =>
    `Invalid --output-format "${format}". Expected "text", "stream-json", or "json".`,
  invalidOutputProfile: (profile: string) =>
    `Invalid --output-profile "${profile}". Expected "native", "anthropic", or "openai".`,
  invalidAuditScope: (scope: string) =>
    `Invalid --audit-scope "${scope}". Expected "repo" or "user".`,
  headlessToolPayloadRequiresStreamJson:
    '--headless-include-tool-input/--headless-include-tool-output are only valid when --output-format is set to "stream-json".',
  headlessToolPayloadNotSupportedWithOpenAiProfile:
    '--headless-include-tool-input/--headless-include-tool-output are not supported with --output-profile "openai".',
  headlessAuthorizationDecisionsRequireHeadlessOutput:
    '--headless-include-authorization-decisions is only valid when --output-format is set to "json" or "stream-json".',
  headlessAuthorizationDecisionsNotSupportedWithStrictProfiles:
    '--headless-include-authorization-decisions is not supported with --output-profile "anthropic" or "openai".',
  outputProfileRequiresStreamJson:
    '--output-profile is only valid when --output-format is set to "stream-json".',
  outputProfileNotSupportedYet: (profile: string) =>
    `--output-profile "${profile}" is not supported. Expected "native", "anthropic", or "openai".`,
  continueResumeConflict: '--continue and --resume are mutually exclusive.',
  resumeNotFound: (id: string) => `Session not found: ${id}.`,
  invalidLlmOutputKind: (kind?: string) =>
    `Invalid --llm-output value${kind ? `: "${kind}"` : ''}. Expected "none", "all", or a comma-separated list of: review, assistant_message, explore, research, plan, patch.`,
  contextInvalidDiffScope: (scope: string) =>
    `Invalid --diff-scope "${scope}". Expected "primary" or "ast_related".`,
  contextInvalidBudgetChars: (value: string) => `Invalid --budget-chars "${value}".`,
  apiKeyMissing:
    '[WARN] SALMONLOOP_API_KEY not found, using StubLLM. Set SALMONLOOP_API_KEY (or legacy S8P_API_KEY) to use a real LLM.',
  providerNotSupported: (type: string) =>
    `[WARN] Provider "${type}" is not supported yet. Falling back to StubLLM.`,
  clientPackageNotSupported: (pkg: string) =>
    `[WARN] LLM client.package "${pkg}" is not supported. Falling back to the default client.`,

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
  starting: 'Starting salmon-loop...',
  runningWith: 'Running salmon-loop with:',
  scope: (scope: string) => `  Scope: ${scope}`,
  verify: (command: string) => `  Verify: ${command}`,
  instruction: (instruction: string) => `  Instruction: ${instruction}`,
  repoPath: (path: string) => `  Repo path: ${path}`,
  allowedTools: (rules: string) => `  Allowed tools: ${rules}`,
  disallowedTools: (rules: string) => `  Disallowed tools: ${rules}`,
  configPath: (path: string) => `  Config file: ${path}`,
  contextFile: (file: string) => `  Context file: ${file}`,
  contextSelection: (length: number) => `  Context selection length: ${length}`,
  dryRunEnabled: '  Dry-run mode enabled',
  target: (path: string) => `  Target: ${path}`,

  // Result output
  result: 'Result:',
  operationSuccess: '\nOperation completed successfully.',
  operationFailed: '\nOperation failed.',
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
  budgetSummaryTitle: '  Budget summary:',
  budgetSummaryLine: (
    attempts: number,
    adjustments: number,
    alerts: number,
    criticalDrops: number,
    avgUtilizationPercent: number,
    truncationRatePercent: number,
    successRatePercent: number,
  ) =>
    `    attempts=${attempts} adjustments=${adjustments} alerts=${alerts} critical_drops=${criticalDrops} avg_utilization=${avgUtilizationPercent}% truncation_rate=${truncationRatePercent}% success_rate=${successRatePercent}%`,
  diffMeta: (files: number, lines: number) => `  Diff: ${files} files changed, ${lines} lines.`,
  uiDiffMeta: (files: number, lines: number) => `Diff: ${files} file(s), ${lines} line(s) changed.`,
  uiVerifyPassed: 'Verify passed.',
  uiVerifyFailed: 'Verify failed.',
  uiToolFailed: (tool: string, status: string) => `Tool failed: ${tool} (${status}).`,
  retry: (from: number, to: number, reason: string) =>
    `\nRetrying (${from} -> ${to}). Reason: ${reason}`,
  contextBuilt: (usedChars: number, truncated: boolean) =>
    `Context built (${usedChars} chars, truncated=${truncated})`,

  // Step logs
  stepLogs: 'Step Logs:',
  stepEntry: (index: number, step: string, success: boolean) =>
    `  ${index + 1}. ${step}: ${success ? '[ok]' : '[error]'}`,
  stepError: (error: string) => `     Error: ${error}`,
  stepOutput: (output: string, maxLen: number) => {
    const truncated = output.length > maxLen;
    return `     Output: ${output.substring(0, maxLen)}${truncated ? '...' : ''}`;
  },

  rawPatch: (patch: string) => `  [DEBUG] Raw Patch:\n${patch}`,

  // Patch output
  finalPatch: 'Final Patch:',

  // Errors
  error: (error: string) => `Error: ${error}`,
  unexpectedError: (error: string) => `Unexpected error: ${error}`,
  runningValidation: 'Running validation checks...',
  validationUsingPackageManager: (packageManager: string) =>
    `  Using detected package manager: ${packageManager}`,
  runningScript: (scriptName: string, command: string) =>
    `  Running "${scriptName}" script via: ${command}`,
  scriptMissing: (scriptName: string) =>
    `  Skipping "${scriptName}" because package.json has no "${scriptName}" script.`,
  validationSkippedNoPackageJson: 'Validation skipped: no package.json found in target repository.',
  validationSkippedNoScripts:
    'Validation skipped: neither "lint" nor "test" script exists in package.json.',
  runningEslint: '  Running ESLint...',
  runningTests: '  Running Tests...',
  testsFailedContinuing: '  [WARN] Tests failed, but continuing validation...',
  validationCompleted: 'Validation completed.',
  validationFailed: 'Validation failed.',
  validationCommandTimeout: (scriptName: string, command: string) =>
    `  ${scriptName} timed out: ${command}`,
  validationCommandNotFound: (scriptName: string, command: string) =>
    `  ${scriptName} command not found: ${command}`,
  validationCommandExitCode: (scriptName: string, command: string, code: number) =>
    `  ${scriptName} failed (${code}): ${command}`,
  validationCommandSpawnError: (scriptName: string, command: string, reason: string) =>
    `  ${scriptName} failed to start (${command}): ${reason}`,
  validationCommandOutputExceeded: (scriptName: string, command: string) =>
    `  ${scriptName} output exceeded capture limit: ${command}`,
  validationCommandAborted: (scriptName: string, command: string) =>
    `  ${scriptName} aborted: ${command}`,
  invalidPreflightPolicy: (policy: string) =>
    `Invalid --preflight-policy "${policy}". Expected "lenient" or "strict".`,
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
