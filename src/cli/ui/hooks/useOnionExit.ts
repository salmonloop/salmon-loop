import { useInput } from 'ink';

import { useUIStore } from '../store/context.js';

export const useOnionExit = () => {
  const { state, dispatch } = useUIStore();
  const { contextStack } = state;

  useInput((input, key) => {
    if (key.escape) {
      if (contextStack.length > 1) {
        // Pop the top context (Onion Model)
        dispatch({ type: 'POP_CONTEXT' });
      } else {
        // If only 'base' is left, push 'exit-confirm'
        dispatch({ type: 'PUSH_CONTEXT', payload: 'exit-confirm' });
      }
    }

    if (contextStack.includes('exit-confirm')) {
      if (input.toLowerCase() === 'y') {
        process.exit(0);
      } else if (input.toLowerCase() === 'n' || key.escape) {
        dispatch({ type: 'POP_CONTEXT' });
      }
    }
  });

  return {
    currentContext: contextStack[contextStack.length - 1],
    isExitConfirming: contextStack.includes('exit-confirm'),
  };
};
