import { renderHook, act } from '@testing-library/react';

import { useLoopState } from '../../../../../src/cli/ui/hooks/useLoopState.js';
import { LoopEvent } from '../../../../../src/core/types/index.js';

describe('useLoopState', () => {
  it('should initialize with IDLE state', () => {
    const { result } = renderHook(() => useLoopState());

    expect(result.current.state.phase).toBe('IDLE');
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.logs).toHaveLength(1);
    expect(result.current.state.progress).toBe(0);
  });

  it('should update phase and status on phase.start event', () => {
    const { result } = renderHook(() => useLoopState());

    const event: LoopEvent = {
      type: 'phase.start',
      phase: 'PLAN',
      timestamp: new Date(),
    };

    act(() => {
      result.current.handleEvent(event);
    });

    expect(result.current.state.phase).toBe('PLAN');
    expect(result.current.state.status).toBe('running');
  });

  it('should accumulate logs and respect the buffer limit', () => {
    const { result } = renderHook(() => useLoopState());

    act(() => {
      // Add more than 100 logs to test slicing
      for (let i = 0; i < 110; i++) {
        result.current.handleEvent({
          type: 'log',
          level: 'info',
          message: `Log message ${i}`,
          timestamp: new Date(),
        });
      }
    });

    expect(result.current.state.logs).toHaveLength(100);
    expect(result.current.state.logs[0].message).toBe('Log message 10');
    expect(result.current.state.logs[99].message).toBe('Log message 109');
  });

  it('should mark success when VERIFY phase ends successfully', () => {
    const { result } = renderHook(() => useLoopState());

    act(() => {
      result.current.handleEvent({
        type: 'phase.end',
        phase: 'VERIFY',
        success: true,
        timestamp: new Date(),
      });
    });

    expect(result.current.state.status).toBe('success');
    expect(result.current.state.progress).toBe(100);
  });

  it('should maintain current state for other phase.end events', () => {
    const { result } = renderHook(() => useLoopState());

    act(() => {
      result.current.handleEvent({
        type: 'phase.start',
        phase: 'PLAN',
        timestamp: new Date(),
      });

      result.current.handleEvent({
        type: 'phase.end',
        phase: 'PLAN',
        success: true,
        timestamp: new Date(),
      });
    });

    expect(result.current.state.phase).toBe('PLAN');
    expect(result.current.state.status).toBe('running'); // Should still be running until VERIFY
  });
});
