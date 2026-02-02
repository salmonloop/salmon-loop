import { useStdout } from 'ink';
import { useEffect, useRef } from 'react';

import { UI_CONFIG } from '../config.js';
import { useUIStore } from '../store/context.js';

/**
 * Hook to handle terminal resizing with throttling.
 */
export function useTerminalDimensions() {
  const { stdout } = useStdout();
  const { dispatch } = useUIStore();
  const resizeTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        dispatch({
          type: 'UPDATE_DIMENSIONS',
          payload: {
            width: stdout?.columns || UI_CONFIG.DEFAULT_WIDTH,
            height: stdout?.rows || UI_CONFIG.DEFAULT_HEIGHT,
          },
        });
      }, UI_CONFIG.RESIZE_THROTTLE_MS);
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    };
  }, [stdout, dispatch]);
}
