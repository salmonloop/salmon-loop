import type { ExecutionPlan } from '../../grizzco/dsl/DecisionEngine.js';
import type { SlashDispatchDecision } from '../types.js';

export type SlashInternalData = {
  __plan?: ExecutionPlan;
  __decision?: SlashDispatchDecision;
};
