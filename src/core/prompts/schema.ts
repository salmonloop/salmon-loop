export interface ExplorePromptVars {
  context: string;
  instruction: string;
  lastError?: string;
}

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

export interface ResearchPromptVars {
  context: string;
  instruction: string;
}

export interface ReviewPromptVars {
  contextJson: string;
}
