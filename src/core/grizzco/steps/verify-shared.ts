import { ArtifactStore } from '../../sub-agent/artifacts/store.js';
import type { ArtifactHandle } from '../../sub-agent/artifacts/types.js';
import { runVerify as runVerifyCommand, type VerifyResult } from '../../verification/runner.js';

export async function executeVerifyForWorkspace(params: {
  workspacePath: string;
  verify: string;
  signal?: AbortSignal;
}): Promise<{ verifyResult: VerifyResult; verifyArtifact?: ArtifactHandle }> {
  const verifyResult = await runVerifyCommand(
    params.workspacePath,
    params.verify,
    undefined,
    params.signal,
  );
  let verifyArtifact: ArtifactHandle | undefined;

  if (!verifyResult.ok && verifyResult.output) {
    try {
      verifyArtifact = await ArtifactStore.saveText({
        content: verifyResult.output,
        mimeType: 'text/plain',
        fileExt: 'log',
      });
    } catch {
      // Best-effort only; keep verifyResult.output in-memory for shrink/error classification.
    }
  }

  return {
    verifyResult,
    ...(verifyArtifact ? { verifyArtifact } : {}),
  };
}
