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
    reason?:
      | 'ok'
      | 'not_found'
      | 'manifest_unavailable'
      | 'manifest_parse_error'
      | 'manifest_io_error'
      | 'manifest_lock_timeout';
  } | null;
}
