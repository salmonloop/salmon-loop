import { Context, LoopIteration, Plan } from '../types/index.js';

export interface ReflectionInput {
  instruction: string;
  history: LoopIteration[];
  success: boolean;
  metadata?: Context['projectMetadata'];
  finalPlan?: Plan | null;
  finalPatch?: string | null;
}

export interface ReflectionResult {
  lessons: string[];
  suggestedRules?: string[];
  suggestedDecisions?: string[];
}
