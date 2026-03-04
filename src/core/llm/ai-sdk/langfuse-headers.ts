export function buildLangfuseHeaders(
  enabled: boolean,
  input: {
    runId?: string;
    phase?: string;
    observationName?: string;
    observationId?: string;
    sessionId?: string;
    userId?: string;
  },
): Record<string, string> {
  if (!enabled) return {};
  if (!input.runId) return {};

  const headers: Record<string, string> = {
    langfuse_trace_id: input.runId,
    langfuse_trace_name: 'salmonloop.run',
  };

  if (input.sessionId) {
    headers.langfuse_session_id = input.sessionId;
  }

  if (input.userId) {
    headers.langfuse_trace_user_id = input.userId;
  }

  const obsName = (input.observationName || input.phase || '').trim();
  if (obsName) headers.langfuse_observation_name = obsName;

  if (input.observationId) {
    headers.langfuse_observation_id = input.observationId;
  }

  const release = (process.env.SALMONLOOP_LANGFUSE_RELEASE || '').trim();
  if (release) {
    headers.langfuse_release = release;
  }

  return headers;
}
