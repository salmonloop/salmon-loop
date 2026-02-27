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
