import { ExecutionPlan } from './DecisionEngine.js';

export type DecisionResult = PlanResult | NeedDataResult;

export interface PlanResult {
  type: 'PLAN';
  plan: ExecutionPlan;
}

export interface NeedDataResult {
  type: 'NEED_DATA';
  keys: string[];
  reason?: string;
}
