import { LIMITS } from '../limits.js';
import type { ExecutionPhase, LoopIteration, StepLog } from '../types.js';

export class LoopTelemetry {
  private readonly logs: StepLog[] = [];
  private readonly history: LoopIteration[] = [];

  constructor(private readonly now: () => Date) {}

  recordLog(step: ExecutionPhase | 'error' | 'UNKNOWN', output: unknown, success = true): StepLog {
    let outputStr: string;

    if (typeof output === 'string') {
      outputStr = output;
    } else {
      outputStr = (() => {
        try {
          return JSON.stringify(output);
        } catch {
          try {
            return String(output);
          } catch {
            return '[Unserializable]';
          }
        }
      })();
    }

    if (outputStr.length > LIMITS.maxLogLength) {
      outputStr = outputStr.substring(0, LIMITS.maxLogLength) + '\n...[Truncated due to length]...';
    }

    const log: StepLog = {
      step,
      success,
      output: outputStr,
      timestamp: this.now(),
    };

    this.logs.push(log);
    return log;
  }

  addHistory(entry: LoopIteration): void {
    this.history.push(entry);
  }

  getLogs(): StepLog[] {
    return [...this.logs];
  }

  getHistory(): LoopIteration[] {
    return [...this.history];
  }
}
