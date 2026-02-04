import type { AuthorizationDecision } from '../../../core/tools/authorization/types.js';
import type { UIAction, UIState } from '../store/types.js';

export interface AuthorizationPrompt {
  id: string;
  message: string;
  challenge: string;
}

let dispatchRef: ((action: UIAction) => void) | null = null;
let pendingRef: AuthorizationPrompt | null = null;
let resolverRef: ((decision: AuthorizationDecision) => void) | null = null;

export function bindAuthorizationDispatch(dispatch: (action: UIAction) => void) {
  dispatchRef = dispatch;
}

export function requestAuthorization(prompt: AuthorizationPrompt): Promise<AuthorizationDecision> {
  if (!dispatchRef) return Promise.resolve({ outcome: 'deny', reason: 'UI unavailable' });
  if (resolverRef) return Promise.resolve({ outcome: 'deny', reason: 'Authorization pending' });

  pendingRef = prompt;
  dispatchRef({ type: 'SET_AUTHORIZATION', payload: prompt });

  return new Promise<AuthorizationDecision>((resolve) => {
    resolverRef = resolve;
  });
}

export function resolveAuthorization(id: string, decision: AuthorizationDecision) {
  if (!pendingRef || pendingRef.id !== id || !resolverRef) return;
  const resolve = resolverRef;
  resolverRef = null;
  pendingRef = null;
  dispatchRef?.({ type: 'CLEAR_AUTHORIZATION' });
  resolve(decision);
}

export function rejectAuthorization() {
  if (!pendingRef || !resolverRef) return;
  resolveAuthorization(pendingRef.id, { outcome: 'deny', reason: 'User cancelled' });
}

export function getPendingAuthorization(): UIState['pendingAuthorization'] | null {
  return pendingRef;
}
