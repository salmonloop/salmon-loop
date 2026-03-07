import { builtinModules } from 'module';

import type { EnvironmentMode, ExecutionPhase, LoopReasonCode } from '../types/index.js';

export interface FailureGuidance {
  diagnosticCode: string;
  safeHint: string;
  remediationSteps: string[];
}

export interface BuildFailureGuidanceInput {
  reasonCode: LoopReasonCode;
  failurePhase: ExecutionPhase;
  errorCode?: string;
  verifyOutput?: string;
  environmentMode?: EnvironmentMode;
  fallbackReason: string;
}

function extractMissingModule(output: string): string | undefined {
  const patterns = [
    /TS2307:\s+Cannot find module ['"]([^'"]+)['"]/i,
    /Cannot find module ['"]([^'"]+)['"]/i,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

const BUILTIN_MODULES = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const SAFE_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function isBarePackageSpecifier(specifier: string): boolean {
  const trimmed = specifier.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('\\')) return false;
  if (trimmed.startsWith('node:') || trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('~/') || trimmed.startsWith('@/')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  if (BUILTIN_MODULES.has(trimmed)) return false;
  return true;
}

function extractPackageName(specifier: string): string | undefined {
  if (!isBarePackageSpecifier(specifier)) return undefined;
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    if (!scope || !name) return undefined;
    return `${scope}/${name}`;
  }
  return specifier.split('/')[0] || undefined;
}

function isSafePackageName(packageName: string): boolean {
  return SAFE_PACKAGE_NAME_PATTERN.test(packageName);
}

function inferInstallCommand(output: string, pkg: string): string {
  const lower = output.toLowerCase();
  if (lower.includes('pnpm')) return `pnpm add ${pkg}`;
  if (lower.includes('yarn')) return `yarn add ${pkg}`;
  if (lower.includes('npm')) return `npm install ${pkg}`;
  return `bun add ${pkg}`;
}

function buildGenericDependencyGuidance(): FailureGuidance {
  return {
    diagnosticCode: 'VERIFY_DEPENDENCY_ERROR',
    safeHint:
      'Verification failed because dependency setup is incomplete in the execution environment.',
    remediationSteps: [
      'Install project dependencies in the repository root and retry.',
      'If this keeps failing, ensure all imported packages are declared in package.json.',
    ],
  };
}

function buildDependencyGuidance(input: BuildFailureGuidanceInput): FailureGuidance | undefined {
  if (input.reasonCode !== 'VERIFY_FAILED') return undefined;
  const output = input.verifyOutput || '';
  const missingSpecifier = extractMissingModule(output);
  if (!missingSpecifier) {
    if (input.errorCode !== 'dependency_error') return undefined;
    return buildGenericDependencyGuidance();
  }

  const packageName = extractPackageName(missingSpecifier);
  if (!packageName || !isSafePackageName(packageName)) {
    if (input.errorCode !== 'dependency_error') return undefined;
    return buildGenericDependencyGuidance();
  }

  const installCommand = inferInstallCommand(output, packageName);
  const modeHint =
    input.environmentMode === 'strict'
      ? 'strict mode uses an isolated worktree and does not inherit parent-level node_modules.'
      : 'isolated execution may not reuse parent-level node_modules.';

  return {
    diagnosticCode: 'UNDECLARED_DEPENDENCY',
    safeHint: `Missing declared dependency '${packageName}' in verification environment.`,
    remediationSteps: [
      `Declare and install it in this project (for example: \`${installCommand}\`).`,
      'Commit the updated lockfile so isolated environments can reproduce dependencies.',
      `Why this happens: ${modeHint}`,
    ],
  };
}

function buildErrorCodeGuidance(input: BuildFailureGuidanceInput): FailureGuidance | undefined {
  switch (input.errorCode) {
    case 'LLM_HTTP_REQUEST_FAILED':
      return {
        diagnosticCode: 'LLM_HTTP_REQUEST_FAILED',
        safeHint: 'LLM request failed. Please retry in a moment.',
        remediationSteps: [
          'Retry the command after a short delay.',
          'If it persists, check provider status or credentials.',
        ],
      };
    case 'LLM_HTTP_ABORTED':
      return {
        diagnosticCode: 'LLM_HTTP_ABORTED',
        safeHint: 'LLM request was aborted. Please retry.',
        remediationSteps: [
          'Retry the command.',
          'If it persists, check network connectivity or timeouts.',
        ],
      };
    case 'noFilesRead':
      return {
        diagnosticCode: 'NO_FILES_READ',
        safeHint:
          'Exploration did not read any files. Your instruction may be too vague (for example, "review my code"). Please specify the exact file(s) or scope you want to work with.',
        remediationSteps: [
          'Explicitly open the target file(s) in your editor, or reference them in your instruction (for example: "review src/main.ts").',
          'If you want to review recent changes, try "review the last committed files" or "review git diff".',
          'Retry the command after opening or referencing the specific files.',
        ],
      };
    case 'explorationHallucination':
      return {
        diagnosticCode: 'EXPLORATION_HALLUCINATION',
        safeHint:
          'Exploration found candidate files via search but did not read them. This usually happens when the instruction is ambiguous (e.g., "review my code" without specifying which files).',
        remediationSteps: [
          'Open the specific file(s) you want to work with in your editor, or reference them explicitly in your instruction.',
          'If you saw file names in search results, try: "review <file-path>" or "analyze <file-path>".',
          'For ambiguous instructions like "review my code", the agent needs you to clarify which files or scope to focus on.',
        ],
      };
    case 'PATCH_NOT_APPLICABLE':
      return {
        diagnosticCode: 'PATCH_NOT_APPLICABLE',
        safeHint: 'Patch could not be applied cleanly. Please retry.',
        remediationSteps: [
          'Re-run after syncing with the latest file contents.',
          'If it keeps failing, rerun with a smaller, more targeted change.',
        ],
      };
    case 'LLM_PATCH_EMPTY':
      return {
        diagnosticCode: 'LLM_PATCH_EMPTY',
        safeHint: 'LLM returned an empty patch. Please retry.',
        remediationSteps: ['Retry the command.'],
      };
    case 'LLM_PATCH_NOT_UNIFIED_DIFF':
      return {
        diagnosticCode: 'LLM_PATCH_NOT_UNIFIED_DIFF',
        safeHint: 'LLM returned a patch in an unsupported format. Please retry.',
        remediationSteps: ['Ensure the patch is in unified diff format.'],
      };
    case 'lint':
      return {
        diagnosticCode: 'LINT_FAILED',
        safeHint: 'Linting failed. Fix lint issues and retry.',
        remediationSteps: ['Run the lint command locally to see details.'],
      };
    case 'test':
      return {
        diagnosticCode: 'TEST_FAILED',
        safeHint: 'Tests failed. Fix test failures and retry.',
        remediationSteps: ['Run the test command locally to see details.'],
      };
    case 'Error':
      return {
        diagnosticCode: 'UNEXPECTED_ERROR',
        safeHint: 'An unexpected error occurred. Check the audit log for details and retry.',
        remediationSteps: [
          'Retry the command; if it persists, inspect the audit log for specifics.',
        ],
      };
    default:
      return undefined;
  }
}

export function buildFailureGuidance(input: BuildFailureGuidanceInput): FailureGuidance {
  const dependencyGuidance = buildDependencyGuidance(input);
  if (dependencyGuidance) return dependencyGuidance;

  const errorCodeGuidance = buildErrorCodeGuidance(input);
  if (errorCodeGuidance) return errorCodeGuidance;

  if (input.reasonCode === 'PREFLIGHT_NOT_GIT') {
    return {
      diagnosticCode: 'PREFLIGHT_NOT_GIT',
      safeHint: 'Run failed because the target directory is not a Git repository.',
      remediationSteps: [
        'Run the command from a Git repository root, or initialize one with `git init`.',
      ],
    };
  }

  if (input.reasonCode === 'PREFLIGHT_DIRTY') {
    return {
      diagnosticCode: 'PREFLIGHT_DIRTY',
      safeHint: 'Run failed because the workspace has local changes that must be handled first.',
      remediationSteps: ['Commit/stash local changes, or switch to worktree strategy and retry.'],
    };
  }

  if (input.reasonCode === 'APPLY_BACK_FAILED') {
    return {
      diagnosticCode: 'APPLY_BACK_FAILED',
      safeHint: input.fallbackReason,
      remediationSteps: ['Resolve conflicting local changes, then retry.'],
    };
  }

  return {
    diagnosticCode: input.reasonCode,
    safeHint: input.fallbackReason,
    remediationSteps: [
      'Check the audit log for phase-level details and retry after fixing the issue.',
    ],
  };
}
