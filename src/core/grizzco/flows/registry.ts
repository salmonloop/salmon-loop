import type { FlowMode } from '../../types.js';

import { DebugFlowStrategy, PatchFlowStrategy, ReviewFlowStrategy } from './strategies.js';
import { flowRegistry } from './strategy-registry.js';
import type { FlowStrategy } from './strategy-registry.js';

const defaultStrategies: Array<[FlowMode, () => FlowStrategy]> = [
  ['patch', () => new PatchFlowStrategy()],
  ['review', () => new ReviewFlowStrategy()],
  ['debug', () => new DebugFlowStrategy()],
];

export function initializeFlowStrategies(): void {
  for (const [mode, factory] of defaultStrategies) {
    if (!flowRegistry.has(mode)) {
      flowRegistry.register(mode, factory());
    }
  }
}
