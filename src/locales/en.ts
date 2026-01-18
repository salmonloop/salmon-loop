export const en = {
  prompts: {
    plan: (context: string, instruction: string, maxFilesChanged: number) => `You are a code modification assistant. Please generate a detailed modification plan based on the following context and instruction.

# Context
${context}

# Instruction
${instruction}

# Requirements
- The plan must be in JSON format, containing the fields reasoning, steps, and filesToChange.
- Each step in the steps array must include description, file, and changeType.
- changeType can only be 'modify', 'add', or 'delete'.
- You cannot modify more than ${maxFilesChanged} files.
- Do not generate code, only describe the modification plan.

Please return the plan in pure JSON format:`,

    patch: (plan: string, context: string, maxFilesChanged: number, maxDiffLines: number) => `You are a code modification assistant. Please generate a unified diff format patch based on the following plan and context.

# Plan
${plan}

# Context
${context}

# Requirements
- Must generate standard unified diff format.
- The patch must precisely match the modifications in the plan.
- You cannot modify more than ${maxFilesChanged} files.
- The diff must not exceed ${maxDiffLines} lines.
- You cannot add new files or delete files.
- You cannot perform refactoring or formatting changes.

Please return the patch in pure unified diff format:`,
  },

  loop: {
    starting: '🚀 Starting salmon-loop...',
    planFailed: (error: string) => `Plan failed: ${error}`,
    patchGenerationFailed: (error: string) => `Patch generation failed: ${error}`,
    patchApplyFailed: (error: string) => `Patch application failed: ${error}`,
    verificationFailed: (error: string) => `Verification failed: ${error}`,
    success: 'Successfully completed',
    maxRetriesExceeded: (maxRetries: number, lastError?: string) => `Exceeded maximum retries (${maxRetries}), last error: ${lastError}`,
    contextShrinking: 'Shrinking context and retrying...',
    rollbackAndShrink: 'Rolling back and shrinking context...',
  },

  verify: {
    truncated: (maxLines: number) => `...[Output truncated, exceeds ${maxLines} lines]`,
  },

  cli: {
    // 程序描述
    programDescription: 'A minimal viable loop for automated code patching',
    runDescription: 'Run the salmon-loop',

    // 选项描述
    instructionOption: 'Instruction for code modification (required)',
    verifyOption: 'Verification command to run (e.g., "npm test") (required)',
    repoOption: 'Repository path (default: current directory)',
    fileOption: 'Target file path (relative to repo)',
    selectionOption: 'Direct text selection (mutually exclusive with --file)',
    dryRunOption: 'Generate patch without applying',
    verboseOption: 'Print step logs',

    // 错误提示
    fileSelectionConflict: '--file and --selection are mutually exclusive',
    instructionRequired: '--instruction is required',
    verifyRequired: '--verify is required',

    // 启动信息
    starting: '🚀 Starting salmon-loop...',
    scope: (scope: string) => `  Scope: ${scope}`,
    verify: (command: string) => `  Verify: ${command}`,
    instruction: (instruction: string) => `  Instruction: ${instruction}`,
    target: (path: string) => `  Target: ${path}`,

    // 结果输出
    result: '📊 Result:',
    success: (success: boolean) => `  Success: ${success}`,
    reason: (reason: string) => `  Reason: ${reason}`,
    attempts: (attempts: number) => `  Attempts: ${attempts}`,

    // 步骤日志
    stepLogs: '📝 Step Logs:',
    stepEntry: (index: number, step: string, success: boolean) =>
      `  ${index + 1}. ${step}: ${success ? '✅' : '❌'}`,
    stepError: (error: string) => `     Error: ${error}`,
    stepOutput: (output: string, maxLen: number) => {
      const truncated = output.length > maxLen;
      return `     Output: ${output.substring(0, maxLen)}${truncated ? '...' : ''}`;
    },

    // 补丁输出
    finalPatch: '📄 Final Patch:',

    // 错误
    error: (error: string) => `❌ Error: ${error}`,
  },

  diff: {
    notUnifiedFormat: 'Patch is not in unified diff format',
    tooManyFiles: (count: number, max: number) =>
      `Patch affects ${count} files, maximum allowed is ${max}`,
    tooManyLines: (count: number, max: number) =>
      `Patch has ${count} diff lines, maximum allowed is ${max}`,
  },
};
