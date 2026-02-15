import { text } from '../../../locales/index.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import { ArtifactStore } from '../../sub-agent/artifacts/store.js';
import type { ArtifactHandle } from '../../sub-agent/artifacts/types.js';
import { runVerify as runVerifyCommand } from '../../verification/runner.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { ApplyCtx, VerifyCtx } from '../engine/pipeline/types.js';

function extractCommandProgram(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

export const runVerify: Step<ApplyCtx, VerifyCtx> = async (ctx) => {
  if (!ctx.options.verify) {
    return {
      ...ctx,
      verifyResult: { ok: true, output: text.loop.verificationSkipped, exitCode: null },
    };
  }

  const verifyResult = await runVerifyCommand(ctx.workspace.workPath, ctx.options.verify);
  let verifyArtifact: ArtifactHandle | undefined;

  recordAuditEvent(
    'verify.summary',
    {
      ok: verifyResult.ok,
      exitCode: verifyResult.exitCode,
      outputChars: verifyResult.output?.length ?? 0,
      commandProgram: extractCommandProgram(ctx.options.verify),
      commandLength: ctx.options.verify.length,
    },
    {
      source: 'verification',
      severity: verifyResult.ok ? 'low' : 'medium',
      scope: 'session',
      phase: 'VERIFY',
    },
  );

  if (!verifyResult.ok) {
    ctx.emit({
      type: 'log',
      level: 'warn',
      message: text.loop.verificationFailedSummary,
      timestamp: new Date(),
    });
    if (verifyResult.output) {
      try {
        verifyArtifact = await ArtifactStore.saveText({
          content: verifyResult.output,
          mimeType: 'text/plain',
          fileExt: 'log',
        });
        ctx.emit({
          type: 'log',
          level: 'debug',
          message: text.loop.verificationOutputStored(verifyArtifact.handle),
          timestamp: new Date(),
        });
      } catch {
        // Best-effort only; keep verifyResult.output in-memory for shrink/error classification.
      }
    }
    // We don't throw here, because we want to trigger rollback/shrink in the pipeline
    // But wait, the Pipeline abstraction propagates errors immediately.
    // If we want Rollback/Shrink to handle this, we should NOT throw here, but return a failed context?
    // OR, we throw a specific error that the Pipeline knows how to handle?

    // If a step fails, the pipeline aborts.
    // BUT we have a linear flow: Verify -> Rollback -> Shrink.
    // If Verify fails, we DO want to continue to Rollback/Shrink.
    // So we should NOT throw Error here. We return the result, and let next steps decide.
  } else {
    ctx.emit({
      type: 'log',
      level: 'info',
      message: text.loop.verificationPassed,
      timestamp: new Date(),
    });
  }

  return {
    ...ctx,
    verifyResult,
    ...(verifyArtifact ? { verifyArtifact } : {}),
  };
};
