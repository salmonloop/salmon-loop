import { randomBytes } from 'crypto';

import {
  applyPlanUpdate,
  appendPlanConflictOnly,
  appendPlanNoteOnly,
  summarizePlan,
} from './markdown-editor.js';
import {
  ensureSalmonloopIgnored,
  readPlanFile,
  resolvePlanFilePath,
  sha256,
  writePlanFileAtomic,
} from './storage.js';
import type { PlanReadResult, PlanUpdatePatch, PlanUpdateResult } from './types.js';

const DEFAULT_TEMPLATE = `# 🦑 Mission: {mission}

> **Objective:** {objective}

## 📍 Context & Strategy
{context}

## 🗺️ Battle Plan (Execution)
- [ ] Work Items <!-- sl:id=work_root sl:status=active -->

## 📝 Field Notes (Reflections)
- (empty)

## ⚠️ Conflicts (Auto-generated)
- (empty)
`;

const writeLocks = new Map<string, Promise<void>>();

async function withPlanWriteLock<T>(planFile: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(planFile) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  writeLocks.set(
    planFile,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );

  try {
    return await next;
  } finally {
    if (writeLocks.get(planFile) === next) {
      writeLocks.delete(planFile);
    }
  }
}

function renderTemplate(params: { mission: string; objective: string; context?: string }): string {
  const context = params.context?.trim() ? params.context.trim() : '(empty)';
  return DEFAULT_TEMPLATE.replace('{mission}', params.mission.trim())
    .replace('{objective}', params.objective.trim())
    .replace('{context}', context);
}

export async function initPlan(params: {
  persistenceRoot: string;
  mission: string;
  objective: string;
  context?: string;
}): Promise<{ sessionId: string; planPathHint: string; baseHash: string }> {
  await ensureSalmonloopIgnored(params.persistenceRoot);
  const sessionId = randomBytes(8).toString('hex');
  const { planDir, planFile, planFileRelHint } = resolvePlanFilePath({
    persistenceRoot: params.persistenceRoot,
    sessionId,
  });

  const content = renderTemplate(params);
  await withPlanWriteLock(planFile, async () => {
    await writePlanFileAtomic(planDir, planFile, content);
  });
  return { sessionId, planPathHint: planFileRelHint, baseHash: sha256(content) };
}

export async function readPlan(params: {
  persistenceRoot: string;
  sessionId: string;
}): Promise<PlanReadResult> {
  const { planFile } = resolvePlanFilePath(params);
  const content = await readPlanFile(planFile);
  const baseHash = sha256(content);
  const summary = summarizePlan(content);
  return {
    sessionId: params.sessionId,
    baseHash,
    active: summary.active,
    pending: summary.pending,
    recentDone: summary.recentDone,
    conflicts: summary.conflicts,
  };
}

export async function updatePlan(params: {
  persistenceRoot: string;
  sessionId: string;
  baseHash: string;
  stepId: string;
  patch: PlanUpdatePatch;
  now?: Date;
}): Promise<PlanUpdateResult> {
  const { planDir, planFile } = resolvePlanFilePath(params);
  return withPlanWriteLock(planFile, async () => {
    const raw = await readPlanFile(planFile);
    const currentHash = sha256(raw);

    if (params.baseHash !== currentHash) {
      const now = params.now ?? new Date();
      const next = appendPlanConflictOnly(raw, {
        message: `BASE_HASH_MISMATCH: stepId=${params.stepId}`,
        note: `Conflict: baseHash mismatch for stepId=${params.stepId}`,
        now,
      });
      await writePlanFileAtomic(planDir, planFile, next);
      return {
        ok: false,
        sessionId: params.sessionId,
        baseHash: sha256(next),
        conflict: {
          code: 'BASE_HASH_MISMATCH',
          message: 'Plan content changed since last read (baseHash mismatch).',
        },
      };
    }

    const now = params.now ?? new Date();
    const res = applyPlanUpdate(raw, { stepId: params.stepId, patch: params.patch, now });
    await writePlanFileAtomic(planDir, planFile, res.content);
    const nextHash = sha256(res.content);

    if (!res.ok) {
      return {
        ok: false,
        sessionId: params.sessionId,
        baseHash: nextHash,
        conflict: {
          code: res.error as any,
          message: `Plan update failed: ${res.error}`,
        },
      };
    }

    return {
      ok: true,
      sessionId: params.sessionId,
      baseHash: nextHash,
      updatedStepId: params.stepId,
    };
  });
}

export async function appendPlanNote(params: {
  persistenceRoot: string;
  sessionId: string;
  note: string;
  now?: Date;
}): Promise<{ baseHash: string }> {
  const { planDir, planFile } = resolvePlanFilePath(params);
  const now = params.now ?? new Date();

  return withPlanWriteLock(planFile, async () => {
    const raw = await readPlanFile(planFile);
    const next = appendPlanNoteOnly(raw, { note: params.note, now });
    await writePlanFileAtomic(planDir, planFile, next);
    return { baseHash: sha256(next) };
  });
}
