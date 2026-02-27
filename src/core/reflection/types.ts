import { LoopIteration, Plan } from '../types/index.js';

export interface ReflectionInput {
  instruction: string;
  history: LoopIteration[];
  success: boolean;
  finalPlan?: Plan | null;
  finalPatch?: string | null;
}

export interface ReflectionResult {
  lessons: string[];
  suggestedRules?: string[];
  suggestedDecisions?: string[];
}
