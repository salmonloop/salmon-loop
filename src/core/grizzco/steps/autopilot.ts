import { createHash } from 'crypto';

import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { SessionReplacementPreviewProvider } from '../../session/replacement-preview-provider.js';
import { chatWithTools, chatWithToolsStreaming } from '../../tools/session.js';
import type { LLM } from '../../types/index.js';
import { Phase } from '../../types/runtime.js';
import { resolveLlmToolCallingPolicy } from '../dsl/llm-strategy.js';
import type { AutopilotCtx, PreflightCtx } from '../engine/pipeline/types.js';

import { buildPhaseToolRuntimeContext } from './tool-runtime.js';
import { buildSharedRequestEnvelope } from './request-assembly.js';
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

function buildAutopilotSystemPrompt(): string {
  return [
    'You are a coding assistant running in "autopilot" mode.',
    'Drive the task forward autonomously and answer in the same language as the user.',
    'Use the repository context available in the current turn when present.',
    'If no repository action is possible yet, explain the next best action succinctly.',
  ].join('\n');
}

type WorkspaceFingerprint = {
  head: string;
  index: string;
  working: string;
};

function hashFingerprintValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decodeNulSeparatedPaths(buffer: Buffer): string[] {
  return buffer
    .toString('utf8')
    .split('\0')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort();
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
    throw new Error(result.error?.message || result.stderr.trim() || `git ${args.join(' ')} failed`);
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

async function captureWorkspaceFingerprint(workspacePath: string): Promise<WorkspaceFingerprint> {
  const git = new GitAdapter(workspacePath);
  const head = (
    await runBoundedGit(git, workspacePath, ['rev-parse', 'HEAD'], GIT_HASH_OUTPUT_LIMITS)
  )
    .toString('utf8')
    .trim();
  const index = (
    await runBoundedGit(git, workspacePath, ['write-tree'], GIT_HASH_OUTPUT_LIMITS)
  )
    .toString('utf8')
    .trim();
  const modifiedAndUntrackedPaths = decodeNulSeparatedPaths(
    await runBoundedGit(
      git,
      workspacePath,
      ['ls-files', '--modified', '--others', '--exclude-standard', '-z'],
      WORKSPACE_SAMPLE_LIMITS,
    ),
  );
  const deletedPaths = decodeNulSeparatedPaths(
    await runBoundedGit(git, workspacePath, ['ls-files', '--deleted', '-z'], WORKSPACE_SAMPLE_LIMITS),
  );

  const workingEntries = [
    ...deletedPaths.map((path) => `${path}:missing`),
    ...(await Promise.all(
      modifiedAndUntrackedPaths.map(async (path) => `${path}:${await hashWorkingPath(git, workspacePath, path)}`),
    )),
  ];
  const working = hashFingerprintValue(workingEntries.join('\n'));

  return { head, index, working };
}

function didWorkspaceFingerprintChange(
  before: WorkspaceFingerprint,
  after: WorkspaceFingerprint,
): boolean {
  return before.head !== after.head || before.index !== after.index || before.working !== after.working;
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

  const shared = buildSharedRequestEnvelope({
    defaultNamespace: 'autopilot',
    systemPrompt: buildAutopilotSystemPrompt(),
    userPrompt: instruction,
    conversationContext: ctx.options.conversationContext,
    artifactHints: ctx.artifactHints,
    toolCallingAudit: ctx.toolCallingAudit,
    previewProvider: new SessionReplacementPreviewProvider(ctx.replacementState),
  });

  const llmClient: LLM = ctx.options.llm;
  const toolPolicy = resolveLlmToolCallingPolicy(AUTOPILOT_TOOL_PHASE, llmClient);
  const localAudit: NonNullable<AutopilotCtx['toolCallingAudit']> = [];
  const supportsStreaming = typeof llmClient.chatStream === 'function';
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
  if (supportsTools) {
    if (samplingFailedClosed || !workspaceFingerprintBefore) {
      mutated = true;
    } else {
      try {
        const workspaceFingerprintAfter = await captureWorkspaceFingerprint(ctx.workspace.workPath);
        mutated = didWorkspaceFingerprintChange(workspaceFingerprintBefore, workspaceFingerprintAfter);
      } catch {
        mutated = true;
      }
    }
  }

  return {
    ...ctx,
    mutated,
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
      verifyResult: { ok: true, output: text.loop.verificationSkipped, exitCode: null },
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
