export type PlanStepStatus = 'todo' | 'active' | 'done' | 'failed' | 'skipped' | 'conflict';

export type PlanCheckboxState = 'checked' | 'unchecked';

export interface PlanStepSummary {
  stepId: string;
  text: string;
  checkbox: PlanCheckboxState;
  status: PlanStepStatus;
}

export interface PlanReadResult {
  sessionId: string;
  baseHash: string;
  active: PlanStepSummary[];
  pending: PlanStepSummary[];
  recentDone: PlanStepSummary[];
  conflicts: { present: boolean; summary?: string };
}

export type PlanUpdatePatch = {
  status?: PlanStepStatus;
  checkbox?: PlanCheckboxState;
  appendSubtasks?: string[];
  note?: string;
};

export type PlanUpdateResult =
  | {
      ok: true;
      sessionId: string;
      baseHash: string;
      updatedStepId: string;
    }
  | {
      ok: false;
      sessionId: string;
      baseHash: string;
      conflict: {
        code: 'BASE_HASH_MISMATCH' | 'STEP_NOT_FOUND' | 'MALFORMED_METADATA' | 'WRITE_DENIED';
        message: string;
      };
    };
