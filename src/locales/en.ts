export const en = {
  llm: {
    planEmpty: 'LLM returned empty response for plan',
    planInvalid: 'Invalid Plan structure: missing required fields',
    planParseFailed: (content: string, error: string) =>
      `Failed to parse LLM response as JSON: ${content}. Error: ${error}`,
    patchEmpty: (reason?: string) =>
      `LLM returned empty response for patch${reason ? ` (${reason})` : ''}`,
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
- **Primary Text**: The ACTUAL content of the files. This is the absolute truth you must modify.
- **Staged Diff**: Represents committed intentions or baseline changes. Respect these as part of the established direction.
- **Unstaged Diff**: Shows recent work in progress. Do not revert or overwrite these changes unless explicitly instructed.
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
    planFailed: (error: string) => `Plan failed: ${error}`,
    patchGenerationFailed: (error: string) => `Patch generation failed: ${error}`,
    patchApplyFailed: (error: string) => `Patch application failed: ${error}`,
    verificationFailed: (error: string) => `Verification failed: ${error}`,
    success: 'Successfully completed',
    maxRetriesExceeded: (maxRetries: number, lastError?: string) =>
      `Exceeded maximum retries (${maxRetries}), last error: ${lastError}`,
    contextShrinking: 'Shrinking context and retrying...',
    rollbackAndShrink: 'Rolling back and shrinking context...',
    diffValidationPassed: 'Diff validation passed',
    contextShrunk: 'Context shrunk for next attempt',
    patchApplied: 'Patch applied successfully',
    dryRunPatchNotApplied: 'Dry run - patch not applied',
    dryRunCompleted: 'Dry run completed: patch generated and validated, but not applied.',
    operationCompleted: 'Operation completed successfully',
    exceededMaxRetriesSimple: 'Exceeded maximum retry attempts',
    loopExecutionFailed: 'Loop execution failed',
    unexpectedTermination: 'Unexpected loop termination',
    rollbackFailed: (error: string) => `Rollback failed: ${error}`,
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
    promotingUnstagedChanges: (file: string) =>
      `[ShadowMergeEngine] File ${file} is in MM (Double Dirty) state. Promoting unstaged changes to index to resolve context dependency.`,
    skippingIgnoredFileOverwrite: (file: string) => `Skipping overwrite of ignored file: ${file}`,
    using3WayMergeStrategy:
      '[ShadowMergeEngine] Using 3-way merge strategy to preserve user changes in dirty workspace.',
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
  },

  context: {
    contentTruncated: '...[Content truncated for context budget]...',
    ripgrepNotFound: 'Error: ripgrep (rg) not found in PATH. Context gathering may be incomplete.',
    ripgrepError: (error: string) => `Error running ripgrep: ${error}`,
    workingDirectory: 'Working Directory: . (Root of the repository)',
    primaryFile: (file: string) => `Primary File: ${file}`,
    primaryText: 'Primary Text:',
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

    // Option descriptions
    instructionOption: 'Instruction for code modification (required)',
    verifyOption: 'Verification command to run (e.g., "npm test") (required)',
    repoOption: 'Repository path (default: current directory)',
    fileOption: 'Target file path (relative to repo)',
    selectionOption: 'Direct text selection (mutually exclusive with --file)',
    dryRunOption: 'Generate patch without applying',
    verboseOption: 'Enable verbose logging (basic, extended)',
    forceResetOption: 'Force hard reset on failure (use with caution)',
    validateOption: 'Run code quality checks (lint and tests)',
    checkpointStrategyOption: 'Checkpoint strategy to use (direct, worktree)',
    applyBackOnDirtyOption: 'Behavior when apply-back detects a dirty workspace (stash, abort)',
    worktreePrepareOption: 'Optional setup command to run inside worktree',

    // Error messages
    fileSelectionConflict: '--file and --selection are mutually exclusive',
    instructionRequired: '--instruction is required',
    verifyRequired: '--verify is required',
    apiKeyMissing:
      '⚠️  SALMON_API_KEY not found, using StubLLM. Set it in .env file to use real LLM.',

    // Startup information
    starting: '🚀 Starting salmon-loop...',
    runningWith: 'Running salmon-loop with:',
    scope: (scope: string) => `  Scope: ${scope}`,
    verify: (command: string) => `  Verify: ${command}`,
    instruction: (instruction: string) => `  Instruction: ${instruction}`,
    repoPath: (path: string) => `  Repo path: ${path}`,
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
    diffMeta: (files: number, lines: number) => `  Diff: ${files} files changed, ${lines} lines.`,
    retry: (from: number, to: number, reason: string) =>
      `\nRetrying (${from} -> ${to}). Reason: ${reason}`,

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
    optionsRequired: 'Error: --instruction and --verify are required unless --validate is used.',
  },

  // Progress bar and interactive feedback
  progress: {
    preflight: 'Preflight checks',
    context: 'Gathering context',
    plan: 'Creating plan',
    patch: 'Generating patch',
    validate: 'Validating patch',
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
  },

  resource: {
    lockAcquireTimeout: (file: string) => `Timeout acquiring lock for file: ${file}`,
    lockReleaseFailed: (file: string) => `Failed to release lock for file: ${file}`,
  },
};
