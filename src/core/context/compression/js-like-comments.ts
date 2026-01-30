export interface StripJsLikeCommentsOptions {
  preserveJSDoc?: boolean;
}

function isRegexAllowedAfter(ch: string | null): boolean {
  if (!ch) return true;
  return /[=([{:,!?&|;+\-*/%^~<>]/.test(ch);
}

export function stripJsLikeComments(
  input: string,
  options: StripJsLikeCommentsOptions = {},
): string {
  const preserveJSDoc = options.preserveJSDoc ?? false;

  let out = '';
  let i = 0;

  let state:
    | 'code'
    | 'single'
    | 'double'
    | 'template'
    | 'regex'
    | 'line_comment'
    | 'block_comment'
    | 'jsdoc_comment' = 'code';

  let lastSignificant: string | null = null;
  let regexCharClassDepth = 0;

  const push = (ch: string) => {
    out += ch;
    if (!/\s/.test(ch)) lastSignificant = ch;
  };

  while (i < input.length) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (state === 'code') {
      if (ch === "'" || ch === '"' || ch === '`') {
        state = ch === "'" ? 'single' : ch === '"' ? 'double' : 'template';
        push(ch);
        i++;
        continue;
      }

      if (ch === '/' && next === '/') {
        state = 'line_comment';
        i += 2;
        continue;
      }

      if (ch === '/' && next === '*') {
        const third = input[i + 2];
        const isJsdoc = third === '*';
        if (preserveJSDoc && isJsdoc) {
          state = 'jsdoc_comment';
          push('/');
          push('*');
          i += 2;
          continue;
        }

        state = 'block_comment';
        i += 2;
        continue;
      }

      if (ch === '/' && next && next !== '/' && next !== '*') {
        if (isRegexAllowedAfter(lastSignificant)) {
          state = 'regex';
          regexCharClassDepth = 0;
          push(ch);
          i++;
          continue;
        }
      }

      push(ch);
      i++;
      continue;
    }

    if (state === 'single' || state === 'double') {
      push(ch);
      if (ch === '\\') {
        if (next) {
          push(next);
          i += 2;
          continue;
        }
      }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) {
        state = 'code';
      }
      i++;
      continue;
    }

    if (state === 'template') {
      push(ch);
      if (ch === '\\') {
        if (next) {
          push(next);
          i += 2;
          continue;
        }
      }
      if (ch === '`') state = 'code';
      i++;
      continue;
    }

    if (state === 'regex') {
      push(ch);
      if (ch === '\\') {
        if (next) {
          push(next);
          i += 2;
          continue;
        }
      }
      if (ch === '[') regexCharClassDepth++;
      if (ch === ']' && regexCharClassDepth > 0) regexCharClassDepth--;
      if (ch === '/' && regexCharClassDepth === 0) {
        state = 'code';
      }
      i++;
      continue;
    }

    if (state === 'line_comment') {
      if (ch === '\n') {
        out += '\n';
        state = 'code';
      }
      i++;
      continue;
    }

    if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state === 'jsdoc_comment') {
      push(ch);
      if (ch === '*' && next === '/') {
        push(next);
        state = 'code';
        i += 2;
        continue;
      }
      i++;
      continue;
    }
  }

  return out;
}
