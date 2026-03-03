import type { UIAction, UIState } from '../store/types.js';

export interface SelectionItem {
  id: string;
  label: string;
  description?: string;
}

export interface SelectionPrompt {
  id: string;
  title: string;
  items: SelectionItem[];
  multiSelect?: boolean;
}

let dispatchRef: ((action: UIAction) => void) | null = null;
let pendingRef: SelectionPrompt | null = null;
let resolverRef: ((result: string[] | null) => void) | null = null;

export function bindSelectionDispatch(dispatch: (action: UIAction) => void) {
  dispatchRef = dispatch;
}

export function requestSelection(prompt: SelectionPrompt): Promise<string[] | null> {
  if (!dispatchRef) return Promise.resolve(null);
  if (resolverRef) return Promise.resolve(null);

  pendingRef = prompt;
  dispatchRef({ type: 'SET_SELECTION', payload: prompt });

  return new Promise<string[] | null>((resolve) => {
    resolverRef = resolve;
  });
}

export function resolveSelection(id: string, itemIds: string[] | null) {
  if (!pendingRef || pendingRef.id !== id || !resolverRef) return;
  const resolve = resolverRef;
  resolverRef = null;
  pendingRef = null;
  dispatchRef?.({ type: 'CLEAR_SELECTION' });
  resolve(itemIds);
}

export function rejectSelection() {
  if (!pendingRef || !resolverRef) return;
  resolveSelection(pendingRef.id, null);
}

export function getPendingSelection(): UIState['pendingSelection'] | null {
  return pendingRef;
}
