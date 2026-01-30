export interface PlanPromptVars {
  context: string;
  instruction: string;
  maxFilesChanged: number;
  lastError?: string;
}

export interface PatchPromptVars {
  plan: string;
  context: string;
  maxFilesChanged: number;
  maxDiffLines: number;
  targetFiles?: string;
  lastError?: string;
}
