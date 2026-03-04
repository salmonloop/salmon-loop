export interface AcpCheckpointMeta {
  id: string;
  createdAt: string | null;
  strategy: string | null;
  backend: string | null;
}

export interface AcpCheckpointSessionMeta {
  latestCheckpointId: string | null;
  checkpoint: AcpCheckpointMeta | null;
  resumeReady?: boolean;
  resumeProbe?: {
    checkpointId: string;
    valid: boolean;
    reason?: string;
  } | null;
}
