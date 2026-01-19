export const en = {
  llm: {
    planEmpty: 'LLM returned empty response for plan',
    planInvalid: 'Invalid Plan structure: missing required fields',
    planParseFailed: (content: string, error: string) =>
      `Failed to parse LLM response as JSON: ${content}. Error: ${error}`,
    patchEmpty: 'LLM returned empty response for patch',
  },

  prompts: {
    plan: (
      context: string,
      instruction: string,
      maxFilesChanged: number,
      lastError?: string,
    ) => `You are a code modification assistant. Please generate a detailed modification plan based on the following context and instruction.

# Context
${context}

# Instruction
${instruction}
${lastError ? `\n# Last Error\nThe previous attempt failed with the following error. Please adjust the plan to fix this issue:\n${lastError}\n` : ''}
# Requirements
- The plan must be in JSON format, containing the fields: goal, files, changes, verify.
- 'goal': A brief description of the goal.
- 'files': An array of file paths to be modified.
- 'changes': An array of strings describing the specific changes.
- 'verify': A verification command or description.
- You cannot modify more than ${maxFilesChanged} files.
- Do not generate code, only describe the modification plan.

Please return the plan in pure JSON format:`,

    patch: (
      plan: string,
      context: string,
      maxFilesChanged: number,
      maxDiffLines: number,
      lastError?: string,
    ) => `You are a code modification assistant. Please generate a unified diff format patch based on the following plan and context.

# Plan
${plan}

# Context
${context}
${lastError ? `\n# Last Error\nThe previous attempt failed with the following error. Please fix the issue described:\n${lastError}\n` : ''}
# Requirements
- Must generate standard unified diff format.
- The patch must precisely match the modifications in the plan.
- You cannot modify more than ${maxFilesChanged} files.
- The diff must not exceed ${maxDiffLines} lines.
- You cannot add new files or delete files.
- You cannot perform refactoring or formatting changes.

Please return the patch in pure unified diff format:`,
  },
  git: {
    applyFailed: (error: string) => `git apply failed: ${error}`,
    applySpawnFailed: (error: string) => `git apply spawn failed: ${error}`,
  },

  diff: {
    notUnifiedFormat: 'Patch is not in unified diff format',
    tooManyFiles: (count: number, max: number) =>
      `Patch affects ${count} files, but you can only modify up to ${max} files.`,
    tooManyLines: (count: number, max: number) =>
      `Patch has ${count} diff lines, but the maximum allowed is ${max} lines.`,
    fileCreationNotAllowed: 'File creation is not allowed in this mode',
    fileDeletionNotAllowed: 'File deletion is not allowed in this mode',
    fileRenameNotAllowed: 'File renaming is not allowed in this mode',
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
      'Safety Guard: --force-reset is not allowed when --allow-dirty is enabled to prevent accidental loss of uncommitted changes.',
  },

  verify: {
    truncated: (maxLines: number) => `...[Output truncated, exceeds ${maxLines} lines]`,
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
    verboseOption: 'Print step logs',
    forceResetOption: 'Force hard reset on failure (use with caution)',
    allowDirtyOption: 'Allow running on a dirty workspace',
    validateOption: 'Run code quality checks (lint and tests)',

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

    // Step logs
    stepLogs: '📝 Step Logs:',
    stepEntry: (index: number, step: string, success: boolean) =>
      `  ${index + 1}. ${step}: ${success ? '✅' : '❌'}`,
    stepError: (error: string) => `     Error: ${error}`,
    stepOutput: (output: string, maxLen: number) => {
      const truncated = output.length > maxLen;
      return `     Output: ${output.substring(0, maxLen)}${truncated ? '...' : ''}`;
    },

    // Patch output
    finalPatch: '📄 Final Patch:',

    // Errors
    error: (error: string) => `❌ Error: ${error}`,
    unexpectedError: (error: string) => `Unexpected error: ${error}`,
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
  },
};
