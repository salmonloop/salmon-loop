export const ARTIFACT_HANDLE_PREFIX = 's8p://artifact/';

export interface ArtifactHandle {
  handle: string;
  mimeType: string;
  sha256: string;
  size: number;
}
