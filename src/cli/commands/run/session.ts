import { ChatSessionManager } from '../../../core/session/manager.js';

export async function initializeSession(params: {
  repoPath: string;
  continueSession: boolean;
  resumeSessionId?: string;
}): Promise<{ sessionManager: ChatSessionManager; sessionId: string }> {
  const sessionManager = new ChatSessionManager(params.repoPath);
  await sessionManager.init();

  if (params.resumeSessionId) {
    await sessionManager.resumeSession(params.resumeSessionId);
  } else if (params.continueSession) {
    const resumed = await sessionManager.loadLast();
    if (!resumed) {
      await sessionManager.create();
    }
  } else {
    await sessionManager.create();
  }

  return { sessionManager, sessionId: sessionManager.getCurrent().meta.id };
}
