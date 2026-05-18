import { createHash } from 'crypto';
import { join } from 'path';

import { text } from '../../../locales/index.js';
import { lstat, readlink } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { supportsLlmStreaming } from '../../llm/capabilities.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { getAutopilotSystemPrompt } from '../../prompts/runtime.js';
import { SessionReplacementPreviewProvider } from '../../session/replacement-preview-provider.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import type { Context } from '../../types/context.js';
import type { LLM } from '../../types/index.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import type { AutopilotCtx, PreflightCtx } from '../engine/pipeline/types.js';

import { buildAugmentedRequestEnvelope } from './request-assembly.js';
import { buildPhaseToolRuntimeContext, buildToolVisibilityRuntime } from './tool-runtime.js';
import { executeVerifyForWorkspace } from './verify-shared.js';

const AUTOPILOT_TOOL_PHASE = Phase.AUTOPILOT;
const WORKSPACE_SAMPLE_LIMITS = {
  maxStdoutBytes: LIMITS.maxToolOutputBytes,
  maxStderrChars: 16_384,
} as const;
const GIT_HASH_OUTPUT_LIMITS = {
  maxStdoutBytes: 256,
  maxStderrChars: 4_096,
} as const;

type WorkspaceFingerprint = {
  head: string;
  index: string;
  statusMetadata: string;
  workingContent: string;
  statusEntries: Array<readonly [path: string, fingerprint: string]>;
  workingEntries: Array<readonly [path: string, fingerprint: string]>;
};

function hashFingerprintValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashFingerprintBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function decodeNulSeparatedRecords(buffer: Buffer): string[] {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter((value) => value.length > 0);
}

function readSpaceDelimitedField(record: string, fieldIndex: number): string {
  let fieldStart = 0;
  let currentField = 0;

  for (let index = 0; index <= record.length; index += 1) {
    const atSeparator = index === record.length || record[index] === ' ';
    if (!atSeparator) {
      continue;
    }

    if (currentField === fieldIndex) {
      return record.slice(fieldStart, index);
    }

    currentField += 1;
    fieldStart = index + 1;
  }

  throw new Error(`Malformed status record: ${record}`);
}

function readPathAfterFieldCount(record: string, fieldCount: number): string {
  let spacesSeen = 0;

  for (let index = 0; index < record.length; index += 1) {
    if (record[index] !== ' ') {
      continue;
    }

    spacesSeen += 1;
    if (spacesSeen === fieldCount) {
      return record.slice(index + 1);
    }
  }

  throw new Error(`Malformed status record: ${record}`);
}

type WorkspaceStatusEntry = {
  path: string;
  statusFingerprint: string;
  hashable: boolean;
};

function collectWorkspaceStatusEntries(statusOutput: Buffer): WorkspaceStatusEntry[] {
  const records = decodeNulSeparatedRecords(statusOutput);
  const entries: WorkspaceStatusEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const kind = record[0];

    if (kind === '?') {
      entries.push({
        path: readPathAfterFieldCount(record, 1),
        statusFingerprint: hashFingerprintValue(record),
        hashable: true,
      });
      continue;
    }

    if (kind === '!') {
      continue;
    }

    if (kind === '1') {
      entries.push({
        path: readPathAfterFieldCount(record, 8),
        statusFingerprint: hashFingerprintValue(record),
        hashable: readSpaceDelimitedField(record, 5) !== '000000',
      });
      continue;
    }

    if (kind === '2') {
      const path = readPathAfterFieldCount(record, 9);
      const originalPath = records[index + 1] ?? '';
      const statusFingerprint = hashFingerprintValue(`${record}\0${originalPath}`);
      entries.push({
        path,
        statusFingerprint,
        hashable: readSpaceDelimitedField(record, 5) !== '000000',
      });
      if (originalPath) {
        entries.push({
          path: originalPath,
          statusFingerprint: hashFingerprintValue(`rename-source:${record}\0${originalPath}`),
          hashable: false,
        });
      }
      index += 1;
      continue;
    }

    if (kind === 'u') {
      entries.push({
        path: readPathAfterFieldCount(record, 10),
        statusFingerprint: hashFingerprintValue(record),
        hashable: readSpaceDelimitedField(record, 6) !== '000000',
      });
      continue;
    }

    throw new Error(`Unsupported status record: ${record}`);
  }

  return entries;
}

async function runBoundedGit(
  git: GitAdapter,
  workspacePath: string,
  args: string[],
  limits: { maxStdoutBytes: number; maxStderrChars: number },
): Promise<Buffer> {
  const result = await git.execMeta(args, {
    cwd: workspacePath,
    limits,
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (result.stdoutTruncated) {
    throw new Error(text.git.outputTruncated(limits.maxStdoutBytes));
  }

  if (!result.ok) {
    throw new Error(
      result.error?.message || result.stderr.trim() || `git ${args.join(' ')} failed`,
    );
  }

  return result.stdout;
}

async function hashWorkingPath(
  git: GitAdapter,
  workspacePath: string,
  filePath: string,
): Promise<string> {
  const output = await runBoundedGit(
    git,
    workspacePath,
    ['hash-object', '--no-filters', '--', filePath],
    GIT_HASH_OUTPUT_LIMITS,
  );
  return output.toString('utf8').trim();
}

async function fingerprintWorkingPath(
  git: GitAdapter,
  workspacePath: string,
  filePath: string,
): Promise<string> {
  const absolutePath = join(workspacePath, filePath);
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    return `symlink:${hashFingerprintValue(await readlink(absolutePath))}`;
  }
  return `file:${await hashWorkingPath(git, workspacePath, filePath)}`;
}

async function captureWorkspaceFingerprint(workspacePath: string): Promise<WorkspaceFingerprint> {
  const git = new GitAdapter(workspacePath);
  const head = (
    await runBoundedGit(git, workspacePath, ['rev-parse', 'HEAD'], GIT_HASH_OUTPUT_LIMITS)
  )
    .toString('utf8')
    .trim();
  const index = (await runBoundedGit(git, workspacePath, ['write-tree'], GIT_HASH_OUTPUT_LIMITS))
    .toString('utf8')
    .trim();
  const statusOutput = await runBoundedGit(
    git,
    workspacePath,
    ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=no'],
    WORKSPACE_SAMPLE_LIMITS,
  );
  const statusEntries = collectWorkspaceStatusEntries(statusOutput);
  const workingEntries: Array<readonly [path: string, fingerprint: string]> = [];
  for (const entry of statusEntries) {
    if (!entry.hashable) {
      continue;
    }
    workingEntries.push([entry.path, await fingerprintWorkingPath(git, workspacePath, entry.path)]);
  }
  const workingContent = hashFingerprintValue(
    workingEntries.map(([path, fingerprint]) => `${path}:${fingerprint}`).join('\n'),
  );

  return {
    head,
    index,
    statusMetadata: hashFingerprintBuffer(statusOutput),
    workingContent,
    statusEntries: statusEntries.map(({ path, statusFingerprint }) => [path, statusFingerprint]),
    workingEntries,
  };
}

function collectChangedWorkspacePaths(
  before: WorkspaceFingerprint,
  after: WorkspaceFingerprint,
): string[] {
  const beforeStatusEntries = new Map(before.statusEntries);
  const afterStatusEntries = new Map(after.statusEntries);
  const beforeEntries = new Map(before.workingEntries);
  const afterEntries = new Map(after.workingEntries);
  const paths = new Set([
    ...beforeStatusEntries.keys(),
    ...afterStatusEntries.keys(),
    ...beforeEntries.keys(),
    ...afterEntries.keys(),
  ]);
  return [...paths]
    .filter(
      (path) =>
        beforeStatusEntries.get(path) !== afterStatusEntries.get(path) ||
        beforeEntries.get(path) !== afterEntries.get(path),
    )
    .filter((path) => !isRuntimeGeneratedPath(path))
    .sort((left, right) => left.localeCompare(right));
}

function isRuntimeGeneratedPath(path: string): boolean {
  if (path === '.salmonloop' || path.startsWith('.salmonloop/')) return true;
  if (path === 'headless.jsonl' || path === 'headless.stderr') return true;
  return false;
}

function lastFailedToolAuditEntry(
  entries: readonly NonNullable<AutopilotCtx['toolCallingAudit']>[number][] | undefined,
): NonNullable<AutopilotCtx['toolCallingAudit']>[number] | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.toolResultStatus && entry.toolResultStatus !== 'ok') {
      return entry;
    }
  }
  return undefined;
}

function resolveAutopilotCompletion(params: {
  content: string;
  mutated: boolean;
  localAudit: AutopilotCtx['toolCallingAudit'];
}): NonNullable<AutopilotCtx['completion']> {
  if (params.mutated) return { status: 'changed' };

  const failedTool = lastFailedToolAuditEntry(params.localAudit);
  if (failedTool) {
    const reason = failedTool.toolResultErrorMessage
      ? `Tool ${failedTool.toolName} failed: ${failedTool.toolResultErrorMessage}`
      : `Tool ${failedTool.toolName} failed.`;
    return {
      status: 'tool_failure',
      reason,
      errorCode: failedTool.toolResultErrorCode,
    };
  }

  if (params.content.trim()) {
    return { status: 'read_only_answer' };
  }

  return {
    status: 'no_effect',
    reason: 'Autopilot completed without changing files or producing an answer.',
  };
}

function buildAutopilotRequestContext(ctx: PreflightCtx, instruction: string): Context {
  const maybeContext = (ctx as PreflightCtx & { context?: Context }).context;
  if (maybeContext?.repoPath && Array.isArray(maybeContext.rgSnippets)) {
    return maybeContext;
  }

  return {
    repoPath: ctx.workspace.workPath,
    instruction,
    contextHash: `autopilot:${ctx.workspace.workPath}`,
    rgSnippets: [],
  };
}

export async function runAutopilot(ctx: PreflightCtx): Promise<AutopilotCtx> {
  const instruction = String(ctx.options.instruction ?? '').trim();
  if (!instruction) {
    return {
      ...ctx,
      mutated: false,
      report: { kind: 'answer', summary: '', timestamp: Date.now() },
    };
  }

  const toolVisibility = buildToolVisibilityRuntime(ctx);
  const requestContext = buildAutopilotRequestContext(ctx, instruction);
  const shared = await buildAugmentedRequestEnvelope({
    phase: AUTOPILOT_TOOL_PHASE,
    defaultNamespace: 'autopilot',
    systemPrompt: await getAutopilotSystemPrompt(),
    context: requestContext,
    baseContextPrompt: instruction,
    buildUserPrompt: async (contextPrompt) => contextPrompt,
    conversationContext: ctx.options.conversationContext,
    artifactHints: ctx.artifactHints,
    toolCallingAudit: ctx.toolCallingAudit,
    previewProvider: new SessionReplacementPreviewProvider(ctx.replacementState),
    toolVisibility: {
      toolstack: ctx.toolstack,
      runtime: toolVisibility,
      worktreeRoot: ctx.workspace.strategy === 'worktree' ? ctx.workspace.workPath : undefined,
      flowMode: ctx.mode,
    },
  });

  const llmClient: LLM = ctx.options.llm;
  const toolPolicy = resolveLlmToolCallingPolicy(AUTOPILOT_TOOL_PHASE, llmClient);
  const localAudit: NonNullable<AutopilotCtx['toolCallingAudit']> = [];
  const supportsStreaming = supportsLlmStreaming(llmClient, AUTOPILOT_TOOL_PHASE);
  const supportsTools = Boolean(ctx.toolstack && toolPolicy.enabled);
  let workspaceFingerprintBefore: WorkspaceFingerprint | null = null;
  let samplingFailedClosed = false;
  if (supportsTools) {
    try {
      workspaceFingerprintBefore = await captureWorkspaceFingerprint(ctx.workspace.workPath);
    } catch {
      samplingFailedClosed = true;
    }
  }

  const assistant = supportsTools
    ? await (supportsStreaming ? chatWithToolsStreaming : chatWithTools)(
        shared.baseMessages,
        {
          phase: AUTOPILOT_TOOL_PHASE,
          providerHints: shared.envelope.providerHints,
          temperature: 0.2,
          signal: ctx.options.signal,
        },
        {
          phase: AUTOPILOT_TOOL_PHASE,
          llm: llmClient,
          runtime: buildPhaseToolRuntimeContext(ctx, AUTOPILOT_TOOL_PHASE, shared.cacheSurface),
          toolVisibility,
          toolstack: ctx.toolstack!,
          eventPayload: ctx.options.eventPayload,
          toolCallingAudit: {
            event: (entry) => {
              localAudit.push(entry);
            },
          },
          maxRounds: toolPolicy.maxRounds,
          llmOutput: {
            policy: ctx.options.llmOutput,
            kind: 'assistant_message',
            step: 'REPORT',
          },
          emit: (event) => ctx.emit({ ...event, timestamp: event.timestamp ?? new Date() }),
        },
      )
    : await llmClient.chat(shared.baseMessages, {
        phase: 'AUTOPILOT',
        providerHints: shared.envelope.providerHints,
        temperature: 0.2,
        signal: ctx.options.signal,
        tools: [],
        toolChoice: 'none',
      });
  const content = String((assistant as any)?.content ?? '').trim();

  if (!supportsTools) {
    emitLlmOutput({
      emit: ctx.emit,
      policy: ctx.options.llmOutput,
      kind: 'assistant_message',
      step: 'REPORT',
      content,
    });
  }

  const mergedAudit =
    localAudit.length > 0 ? [...(ctx.toolCallingAudit ?? []), ...localAudit] : ctx.toolCallingAudit;
  let mutated = false;
  let changedFiles: string[] | undefined;
  if (supportsTools) {
    if (samplingFailedClosed || !workspaceFingerprintBefore) {
      mutated = true;
    } else {
      try {
        const workspaceFingerprintAfter = await captureWorkspaceFingerprint(ctx.workspace.workPath);
        changedFiles = collectChangedWorkspacePaths(
          workspaceFingerprintBefore,
          workspaceFingerprintAfter,
        );
        mutated =
          changedFiles.length > 0 ||
          workspaceFingerprintBefore.head !== workspaceFingerprintAfter.head ||
          workspaceFingerprintBefore.index !== workspaceFingerprintAfter.index;
      } catch {
        mutated = true;
      }
    }
  }

  return {
    ...ctx,
    mutated,
    changedFiles: changedFiles && changedFiles.length > 0 ? changedFiles : undefined,
    completion: resolveAutopilotCompletion({ content, mutated, localAudit }),
    toolCallingAudit: mergedAudit,
    report: {
      kind: 'answer',
      summary: content,
      timestamp: Date.now(),
    },
  };
}

export async function runAutopilotVerifyGate(ctx: AutopilotCtx): Promise<AutopilotCtx> {
  if (!ctx.mutated) {
    return {
      ...ctx,
      verifyResult: undefined,
    };
  }

  if (!ctx.options.verify) {
    return {
      ...ctx,
      completion: {
        status: 'verification_missing',
        reason: 'Autopilot changed the workspace but no verification command was configured.',
        errorCode: 'VERIFY_COMMAND_MISSING',
      },
      verifyResult: undefined,
    };
  }

  const { verifyResult, verifyArtifact } = await executeVerifyForWorkspace({
    workspacePath: ctx.workspace.workPath,
    verify: ctx.options.verify,
    signal: ctx.options.signal,
  });
  const nextCtx: AutopilotCtx = {
    ...ctx,
    verifyResult,
  };

  return verifyArtifact ? ({ ...nextCtx, verifyArtifact } as AutopilotCtx) : nextCtx;
}
