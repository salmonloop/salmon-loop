import { randomBytes } from 'crypto';

import { PlanCheckboxState, PlanStepStatus, type PlanUpdatePatch } from './types.js';

const STEP_ID_RE = /^[a-zA-Z0-9_.:-]{3,128}$/;

export function assertValidStepId(stepId: string): void {
  if (!STEP_ID_RE.test(stepId)) {
    throw new Error('Invalid stepId.');
  }
}

const toCheckboxChar = (state: PlanCheckboxState): ' ' | 'x' => (state === 'checked' ? 'x' : ' ');
const fromCheckboxChar = (raw: string): PlanCheckboxState =>
  raw.toLowerCase() === 'x' ? 'checked' : 'unchecked';

export function generateStepId(prefix = 'stp'): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

function updateCheckboxOnLine(line: string, checkbox?: PlanCheckboxState): string {
  if (!checkbox) return line;
  const re = /(-\s*)\[( |x|X)\]/;
  const match = line.match(re);
  if (!match) return line;
  return line.replace(re, `$1[${toCheckboxChar(checkbox)}]`);
}

function updateStatusInComment(
  line: string,
  status?: PlanStepStatus,
): { line: string; ok: boolean } {
  if (!status) return { line, ok: true };

  const open = '<!--';
  const close = '-->';

  // Find the metadata comment containing sl:id=...
  let idx = 0;
  while (idx < line.length) {
    const start = line.indexOf(open, idx);
    if (start === -1) break;
    const end = line.indexOf(close, start + open.length);
    if (end === -1) return { line, ok: false };

    const comment = line.slice(start, end + close.length);
    if (!comment.includes('sl:id=')) {
      idx = end + close.length;
      continue;
    }

    const key = 'sl:status=';
    if (comment.includes(key)) {
      const keyIdx = comment.indexOf(key);
      const valueStart = keyIdx + key.length;
      let valueEnd = valueStart;
      while (valueEnd < comment.length) {
        const ch = comment[valueEnd];
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '-') break;
        if (comment.startsWith(close, valueEnd)) break;
        valueEnd++;
      }
      const replaced = comment.slice(0, valueStart) + status + comment.slice(valueEnd);
      const nextLine = line.slice(0, start) + replaced + line.slice(end + close.length);
      return { line: nextLine, ok: true };
    }

    // Insert status before -->
    const beforeClose = comment.slice(0, comment.length - close.length);
    const trimmed = beforeClose.endsWith(' ') ? beforeClose : `${beforeClose} `;
    const injected = `${trimmed}sl:status=${status} ${close}`;
    const nextLine = line.slice(0, start) + injected + line.slice(end + close.length);
    return { line: nextLine, ok: true };
  }

  return { line, ok: false };
}

function extractIndent(line: string): string {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : '';
}

function ensureConflictsSection(lines: string[]): number {
  const headingPrefix = '## ⚠️ Conflicts';
  let idx = lines.findIndex((l) => l.trim().startsWith(headingPrefix));
  if (idx !== -1) return idx;
  if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
  idx = lines.length;
  lines.push('## ⚠️ Conflicts (Auto-generated)');
  lines.push('- (empty)');
  return idx;
}

function appendConflict(lines: string[], message: string): void {
  const idx = ensureConflictsSection(lines);
  // Replace placeholder if it's still empty.
  if (lines[idx + 1] && lines[idx + 1].trim() === '- (empty)') {
    lines[idx + 1] = `- ${message}`;
    return;
  }
  lines.splice(idx + 1, 0, `- ${message}`);
}

export function appendPlanConflictOnly(
  raw: string,
  params: { message: string; note?: string; now: Date },
): string {
  const lines = raw.split('\n');
  appendConflict(lines, params.message);
  if (params.note && params.note.trim()) {
    appendFieldNote(lines, params.note.trim(), params.now);
  }
  return lines.join('\n');
}

function appendFieldNote(lines: string[], note: string, now: Date): void {
  const headingRe = /^##\s+/;
  const heading = '## 📝 Field Notes (Reflections)';
  let idx = lines.findIndex((l) => l.trim() === heading);
  if (idx === -1) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('');
    idx = lines.length;
    lines.push(heading);
  }

  // Insert before next heading, or at EOF.
  let insertAt = idx + 1;
  while (insertAt < lines.length && !headingRe.test(lines[insertAt])) insertAt++;

  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  lines.splice(insertAt, 0, `- *${stamp}*: ${note}`);
}

export function appendPlanNoteOnly(raw: string, params: { note: string; now: Date }): string {
  const lines = raw.split('\n');
  appendFieldNote(lines, params.note, params.now);
  return lines.join('\n');
}

function parseStatusFromLine(line: string): PlanStepStatus {
  const m = line.match(/sl:status=([a-zA-Z_]+)/);
  if (!m) return 'todo';
  const raw = m[1];
  switch (raw) {
    case 'todo':
    case 'active':
    case 'done':
    case 'failed':
    case 'skipped':
    case 'conflict':
      return raw;
    default:
      return 'todo';
  }
}

function parseCheckboxFromLine(line: string): PlanCheckboxState {
  const m = line.match(/-\s*\[( |x|X)\]/);
  if (!m) return 'unchecked';
  return fromCheckboxChar(m[1]);
}

function parseTextFromLine(line: string): string {
  // Strip leading "- [ ]" and trailing metadata comment (if any)
  const stripped = line.replace(/^\s*-\s*\[(?: |x|X)\]\s*/, '');
  return stripped.replace(/\s*<!--[\s\S]*?-->\s*$/, '').trim();
}

function parseStepIdFromLine(line: string): string | null {
  const m = line.match(/sl:id=([a-zA-Z0-9_.:-]+)/);
  return m?.[1] ?? null;
}

export function applyPlanUpdate(
  raw: string,
  params: { stepId: string; patch: PlanUpdatePatch; now: Date },
): { ok: true; content: string } | { ok: false; content: string; error: string } {
  const { stepId, patch, now } = params;
  assertValidStepId(stepId);

  const lines = raw.split('\n');
  const idx = lines.findIndex((l) => l.includes(`sl:id=${stepId}`));
  if (idx === -1) {
    appendConflict(lines, `STEP_NOT_FOUND: sl:id=${stepId}`);
    return { ok: false, content: lines.join('\n'), error: 'STEP_NOT_FOUND' };
  }

  let line = lines[idx];
  line = updateCheckboxOnLine(line, patch.checkbox);
  const statusRes = updateStatusInComment(line, patch.status);
  if (!statusRes.ok) {
    appendConflict(lines, `MALFORMED_METADATA: sl:id=${stepId}`);
    return { ok: false, content: lines.join('\n'), error: 'MALFORMED_METADATA' };
  }
  line = statusRes.line;
  lines[idx] = line;

  if (patch.appendSubtasks && patch.appendSubtasks.length > 0) {
    const parentIndent = extractIndent(lines[idx]);
    let subIndent = `${parentIndent}  `;

    // Detect existing subtask indentation style (first immediate child list item)
    for (let i = idx + 1; i < lines.length; i++) {
      const next = lines[i];
      if (next.trim() === '') continue;
      const nextIndent = extractIndent(next);
      if (nextIndent.length <= parentIndent.length) break;
      if (/^\s*-\s*\[( |x|X)\]/.test(next)) {
        subIndent = nextIndent;
        break;
      }
    }

    // Insert after the last child line belonging to this step (block with deeper indent)
    let insertAt = idx + 1;
    while (insertAt < lines.length) {
      const next = lines[insertAt];
      if (next.trim() === '') {
        insertAt++;
        continue;
      }
      const nextIndent = extractIndent(next);
      if (nextIndent.length <= parentIndent.length) break;
      insertAt++;
    }

    const newLines = patch.appendSubtasks.map((t) => {
      const id = generateStepId(`${stepId}`);
      return `${subIndent}- [ ] ${t} <!-- sl:id=${id} -->`;
    });

    lines.splice(insertAt, 0, ...newLines);
  }

  if (typeof patch.note === 'string' && patch.note.trim()) {
    appendFieldNote(lines, patch.note.trim(), now);
  }

  return { ok: true, content: lines.join('\n') };
}

export function summarizePlan(raw: string, limits?: { maxActive?: number; maxPending?: number }) {
  const maxActive = limits?.maxActive ?? 8;
  const maxPending = limits?.maxPending ?? 12;

  const lines = raw.split('\n');

  const steps = lines
    .filter((l) => l.includes('sl:id=') && /^\s*-\s*\[( |x|X)\]/.test(l))
    .map((l) => {
      const stepId = parseStepIdFromLine(l);
      if (!stepId) return null;
      return {
        stepId,
        text: parseTextFromLine(l),
        checkbox: parseCheckboxFromLine(l),
        status: parseStatusFromLine(l),
      };
    })
    .filter(Boolean) as Array<{
    stepId: string;
    text: string;
    checkbox: PlanCheckboxState;
    status: PlanStepStatus;
  }>;

  const active = steps.filter((s) => s.status === 'active').slice(0, maxActive);
  const pending = steps.filter((s) => s.status === 'todo').slice(0, maxPending);
  const recentDone = steps.filter((s) => s.checkbox === 'checked' || s.status === 'done').slice(-3);

  const conflictsHeading = lines.findIndex((l) => l.trim().startsWith('## ⚠️ Conflicts'));
  const conflicts = { present: conflictsHeading !== -1 };
  return { active, pending, recentDone, conflicts };
}
