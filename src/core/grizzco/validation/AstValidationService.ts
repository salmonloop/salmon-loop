import { randomBytes } from 'crypto';
import { readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { AstParser } from '../../ast/index.js';
import { convertDiffToShadowOperations } from '../../patch/diff.js';
import { pluginRegistry } from '../../plugin/registry.js';
import { OpType, type ShadowOperation } from '../domain/grizzco-types.js';

export interface AstValidationResult {
  ok: boolean;
  error?: string;
  filePath?: string;
}

export interface AstValidationDeps {
  convertDiffToShadowOperations: (diff: string) => Promise<ShadowOperation[]>;
  parse: (code: string, lang: string) => Promise<any>;
  resolveLanguage: (filePath: string) => string | undefined;
  buildProposedSource: (workPath: string, operation: ShadowOperation) => Promise<string | null>;
}

function looksLikeUnifiedDiff(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('diff --git ') ||
    trimmed.startsWith('--- a/') ||
    trimmed.startsWith('--- /dev/null')
  );
}

function isAstInfrastructureError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to load language') ||
    lower.includes('failed to initialize ast parser') ||
    (lower.includes('enoent') && lower.includes('tree-sitter'))
  );
}

function defaultResolveLanguage(filePath: string): string | undefined {
  return pluginRegistry.getByExtension(filePath)?.meta.id;
}

async function defaultBuildProposedSource(
  workPath: string,
  operation: ShadowOperation,
): Promise<string | null> {
  if (!operation.content || operation.type === OpType.DELETE) return null;

  const contentText = operation.content.toString('utf8');
  const isDiffPayload = looksLikeUnifiedDiff(contentText);

  // Some callers may provide raw full-file content for OVERWRITE; parse it directly.
  if (operation.type === OpType.OVERWRITE && !isDiffPayload) return contentText;

  // PATCH operations are unified diffs and may only contain hunks.
  // Reconstruct candidate file content by applying the diff to a temporary git index.
  if (!isDiffPayload) return null;

  const git = new GitAdapter(workPath);
  const tempIndex = path.join(tmpdir(), `s8p-ast-${Date.now()}-${randomBytes(4).toString('hex')}`);
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  const patchText = contentText;
  const absoluteTargetPath = path.join(workPath, operation.path);

  try {
    const readTreeResult = await git.execMeta(['read-tree', 'HEAD'], { env });
    if (!readTreeResult.ok) {
      // Unborn branch or missing HEAD: seed temporary index from working tree when possible.
      const existingContent = await readFile(absoluteTargetPath).catch(() => null);
      if (existingContent) {
        const hashRes = await git.execMeta(['hash-object', '-w', '--stdin'], {
          env,
          input: existingContent,
        });
        if (hashRes.ok) {
          const blobHash = hashRes.stdout.toString('utf8').trim();
          if (blobHash) {
            await git.exec(
              ['update-index', '--add', '--cacheinfo', '100644', blobHash, operation.path],
              { env },
            );
          }
        }
      }
    }

    await git.exec(['apply', '--cached', '--recount', '--ignore-whitespace', '-'], {
      env,
      input: Buffer.from(patchText, 'utf8'),
    });

    const showResult = await git.execMeta(['show', `:${operation.path}`], { env });
    if (!showResult.ok) return null;
    return showResult.stdout.toString('utf8');
  } catch {
    return null;
  } finally {
    await rm(tempIndex, { force: true }).catch(() => undefined);
    await rm(`${tempIndex}.lock`, { force: true }).catch(() => undefined);
  }
}

export class AstValidationService {
  private readonly deps: AstValidationDeps;

  constructor(deps: Partial<AstValidationDeps> = {}) {
    this.deps = {
      convertDiffToShadowOperations,
      parse: (code, lang) => AstParser.parse(code, lang),
      resolveLanguage: defaultResolveLanguage,
      buildProposedSource: defaultBuildProposedSource,
      ...deps,
    };
  }

  async validate(args: {
    workPath: string;
    diff: string;
  }): Promise<AstValidationResult> {
    const operations = await this.deps.convertDiffToShadowOperations(args.diff);

    for (const op of operations) {
      if (op.type === OpType.DELETE) continue;

      const lang = this.deps.resolveLanguage(op.path);
      if (!lang) continue;

      try {
        const proposedSource = await this.deps.buildProposedSource(args.workPath, op);
        if (typeof proposedSource !== 'string') continue;

        await this.deps.parse(proposedSource, lang);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Best-effort mode: if AST tooling is unavailable, do not block patch flow.
        if (isAstInfrastructureError(message)) {
          continue;
        }
        return {
          ok: false,
          filePath: op.path,
          error: `AST Syntax Error in ${op.path}: ${message}`,
        };
      }
    }

    return { ok: true };
  }
}
