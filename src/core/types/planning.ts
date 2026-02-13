export interface Plan {
  goal: string;
  files: string[];
  changes: string[];
  verify?: string;
}

export interface PlanStep {
  description: string;
  file: string;
}
