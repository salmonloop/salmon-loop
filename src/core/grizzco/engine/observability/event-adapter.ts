import { sanitizeUiLogMessage } from '../../../observability/ui-log-sanitize.js';
import type { ExecutionPhase, LoopEvent } from '../../../types/runtime.js';

import type { LoopTelemetry } from './loop-telemetry.js';

function sanitizeLoopEvent(event: LoopEvent): LoopEvent {
  if (event.type === 'log') {
    return {
      ...event,
      // Default attribution when not provided by the caller.
      source: event.source ?? 'core',
      message: sanitizeUiLogMessage(event.message, event.level),
    };
  }
  return event;
}

export interface FlowEventAdapterParams {
  onEvent?: (event: LoopEvent) => void;
  telemetry: LoopTelemetry;
}

export interface FlowEventAdapter {
  emitSanitized: (event: LoopEvent) => void;
  emitFlow: (event: LoopEvent) => void;
}

export function createFlowEventAdapter(params: FlowEventAdapterParams): FlowEventAdapter {
  let currentPhase: ExecutionPhase | 'UNKNOWN' = 'UNKNOWN';

  const emitToClient = (event: LoopEvent) => params.onEvent?.(event);
  const emitWithTelemetry = (
    event: LoopEvent,
    telemetryPhase?: ExecutionPhase | 'PREFLIGHT' | 'UNKNOWN',
  ) => {
    emitToClient(event);
    if (event.type === 'log' && telemetryPhase) {
      params.telemetry.recordLog(telemetryPhase, event.message, event.level !== 'error');
    }
  };

  const emitSanitized = (event: LoopEvent) => {
    const sanitizedEvent = sanitizeLoopEvent(event);
    emitWithTelemetry(sanitizedEvent, 'PREFLIGHT');
  };

  const emitFlow = (event: LoopEvent) => {
    const sanitizedEvent = sanitizeLoopEvent(event);
    if (sanitizedEvent.type === 'phase.start') {
      currentPhase = sanitizedEvent.phase;
    } else if (sanitizedEvent.type === 'phase.end') {
      currentPhase = 'UNKNOWN';
    }
    emitWithTelemetry(sanitizedEvent, sanitizedEvent.type === 'log' ? currentPhase : undefined);
  };

  return {
    emitSanitized,
    emitFlow,
  };
}
