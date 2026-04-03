import type {
  RequestArtifactHints,
  ToolResultPreviewArtifactsProvider,
} from '../llm/request-envelope.js';

import type { ToolResultReplacementState } from './replacement-state.js';

export class SessionReplacementPreviewProvider implements ToolResultPreviewArtifactsProvider {
  constructor(private readonly state: ToolResultReplacementState | undefined) {}

  getPreviewHints(): RequestArtifactHints['toolResultPreviewArtifacts'] {
    if (!this.state) return undefined;

    const out = Object.values(this.state.entries)
      .filter((entry) => entry.decision === 'replaced' && entry.sourceArtifactHandle)
      .sort((a, b) => a.frozenAt - b.frozenAt)
      .map((entry) => ({
        label: `Tool result preview: ${entry.toolResultId}`,
        artifact: {
          handle: entry.sourceArtifactHandle as string,
          mimeType: 'application/json',
          sha256: entry.toolResultId,
          size: entry.preview.length,
        },
      }));

    return out.length > 0 ? out : undefined;
  }
}
