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

function inferInstallCommand(output: string, pkg: string): string {
  const lower = output.toLowerCase();
  if (lower.includes('pnpm')) return `pnpm add ${pkg}`;
  if (lower.includes('yarn')) return `yarn add ${pkg}`;
  if (lower.includes('npm')) return `npm install ${pkg}`;
  return `bun add ${pkg}`;
}

function buildDependencyGuidance(input: BuildFailureGuidanceInput): FailureGuidance | undefined {
  if (input.reasonCode !== 'VERIFY_FAILED') return undefined;
  const output = input.verifyOutput || '';
  const missingModule = extractMissingModule(output);
  if (!missingModule) {
    if (input.errorCode !== 'dependency_error') return undefined;
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

  const installCommand = inferInstallCommand(output, missingModule);
  const modeHint =
    input.environmentMode === 'strict'
      ? 'strict mode uses an isolated worktree and does not inherit parent-level node_modules.'
      : 'isolated execution may not reuse parent-level node_modules.';

  return {
    diagnosticCode: 'UNDECLARED_DEPENDENCY',
    safeHint: `Missing declared dependency '${missingModule}' in verification environment.`,
    remediationSteps: [
      `Declare and install it in this project (for example: \`${installCommand}\`).`,
      'Commit the updated lockfile so isolated environments can reproduce dependencies.',
      `Why this happens: ${modeHint}`,
    ],
  };
}

export function buildFailureGuidance(input: BuildFailureGuidanceInput): FailureGuidance {
  const dependencyGuidance = buildDependencyGuidance(input);
  if (dependencyGuidance) return dependencyGuidance;

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
