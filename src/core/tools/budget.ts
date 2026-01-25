import { ExecutionPhase, RiskLevel } from './types';

/**
 * Default budget limits to ensure system stability.
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  maxConcurrentByRisk: {
    low: 10, // High parallelism for search tools
    medium: 3, // Controlled parallelism for MCP/External tools
    high: 1, // Zero-concurrency for mutations (Git, Write, etc.)
  },
  maxCallsPerPhase: 50,
};

export interface BudgetConfig {
  maxConcurrentByRisk: Record<RiskLevel, number>;
  maxCallsPerPhase: number;
}

export class BudgetGuard {
  private activeCallsByRisk = {
    low: 0,
    medium: 0,
    high: 0,
  };
  private callCounts = new Map<string, number>();
  private config: BudgetConfig;

  /**
   * @param partialConfig User provided configuration to override defaults.
   */
  constructor(partialConfig: Partial<BudgetConfig> = {}) {
    // Merge provided config with defaults
    this.config = {
      ...DEFAULT_BUDGET_CONFIG,
      ...partialConfig,
      maxConcurrentByRisk: {
        ...DEFAULT_BUDGET_CONFIG.maxConcurrentByRisk,
        ...(partialConfig.maxConcurrentByRisk || {}),
      },
    };
  }

  /**
   * Updates the budget configuration at runtime.
   * Useful for dynamic load balancing or user-driven adjustments.
   */
  public updateConfig(newConfig: Partial<BudgetConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      maxConcurrentByRisk: {
        ...this.config.maxConcurrentByRisk,
        ...(newConfig.maxConcurrentByRisk || {}),
      },
    };
  }

  async runWithGuards<T>(params: {
    timeoutMs: number;
    maxOutputBytes: number;
    phase: ExecutionPhase;
    toolName: string;
    riskLevel: RiskLevel;
    fn: () => Promise<T>;
  }): Promise<T> {
    // 1. Concurrency Check by Risk Level
    const currentRiskActive = this.activeCallsByRisk[params.riskLevel];
    const maxRiskAllowed = this.config.maxConcurrentByRisk[params.riskLevel];

    if (currentRiskActive >= maxRiskAllowed) {
      throw {
        code: 'BUDGET_CONCURRENCY',
        message: `Too many concurrent ${params.riskLevel}-risk tool calls (limit: ${maxRiskAllowed})`,
      };
    }

    // 2. Rate Limit / Count Check per Phase
    const currentCount = this.callCounts.get(params.phase) || 0;
    if (currentCount >= this.config.maxCallsPerPhase) {
      throw {
        code: 'BUDGET_RATE_LIMIT',
        message: `Too many tool calls in phase ${params.phase}`,
      };
    }

    this.activeCallsByRisk[params.riskLevel]++;
    this.callCounts.set(params.phase, currentCount + 1);

    try {
      // 3. Timeout Wrapper
      const result = await this.runWithTimeout(params.fn, params.timeoutMs);

      // 4. Output Size Check (Preliminary)
      const size = this.estimateSize(result);
      if (size > params.maxOutputBytes) {
        throw {
          code: 'OUTPUT_TOO_LARGE',
          message: `Output size ${size} bytes exceeds limit of ${params.maxOutputBytes}`,
        };
      }

      return result;
    } finally {
      this.activeCallsByRisk[params.riskLevel]--;
    }
  }

  resetCounts() {
    this.callCounts.clear();
  }

  private async runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject({ code: 'TIMEOUT', message: `Tool execution timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private estimateSize(obj: unknown): number {
    if (obj === undefined || obj === null) return 0;
    if (typeof obj === 'string') return obj.length; // UTF-16 approximation
    if (Buffer.isBuffer(obj)) return obj.length;
    try {
      // This is expensive for large objects, but safe for checking limits
      return JSON.stringify(obj).length;
    } catch {
      return 0; // Circular structure or otherwise un-stringifiable
    }
  }
}
