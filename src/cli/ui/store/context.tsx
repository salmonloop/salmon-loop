import React, { createContext, useContext, useReducer, ReactNode } from 'react';

import { uiReducer, initialState } from './reducer.js';
import { UIState, UIAction } from './types.js';

const UIStoreContext = createContext<
  | {
      state: UIState;
      dispatch: React.Dispatch<UIAction>;
    }
  | undefined
>(undefined);

export const UIStoreProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(uiReducer, initialState);

  return <UIStoreContext.Provider value={{ state, dispatch }}>{children}</UIStoreContext.Provider>;
};

export const useUIStore = () => {
  const context = useContext(UIStoreContext);
  if (!context) {
    throw new Error('useUIStore must be used within a UIStoreProvider');
  }
  return context;
};
