import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { AstParser, validateScopeIntegrity } from '../../ast/index.js';
import { convertDiffToShadowOperations } from '../../patch/diff.js';
import { OpType, type ShadowOperation } from '../domain/grizzco-types.js';

export interface AstValidationResult {
  ok: boolean;
  error?: string;
  filePath?: string;
}

export interface AstValidationDeps {
  convertDiffToShadowOperations: (diff: string) => Promise<ShadowOperation[]>;
  parse: (code: string, lang: string) => Promise<any>;
  validateScopeIntegrity: (
    originalTree: any,
    patchedTree: any,
    targetNodeName: string,
  ) => { ok: boolean; reason?: string };
  loadOriginalContent: (workPath: string, filePath: string) => Promise<string | null>;
  resolveLanguage: (filePath: string) => string | undefined;
}

function defaultResolveLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'js') return 'javascript';
  if (ext === 'ts') return 'typescript';
  if (ext === 'py') return 'python';
  return undefined;
}

async function defaultLoadOriginalContent(
  workPath: string,
  filePath: string,
): Promise<string | null> {
  const git = new GitAdapter(workPath);
  try {
    const buf = await git.show('HEAD', filePath);
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

export class AstValidationService {
  private readonly deps: AstValidationDeps;

  constructor(deps: Partial<AstValidationDeps> = {}) {
    this.deps = {
      convertDiffToShadowOperations,
      parse: AstParser.parse,
      validateScopeIntegrity,
      loadOriginalContent: defaultLoadOriginalContent,
      resolveLanguage: defaultResolveLanguage,
      ...deps,
    };
  }

  async validate(args: {
    workPath: string;
    diff: string;
    targetNodeName?: string;
  }): Promise<AstValidationResult> {
    const operations = await this.deps.convertDiffToShadowOperations(args.diff);
    const targetNodeName = args.targetNodeName ?? '';

    for (const op of operations) {
      if (op.type === OpType.DELETE || op.type === OpType.PATCH) continue;
      if (!op.content) continue;

      const lang = this.deps.resolveLanguage(op.path);
      if (!lang) continue;

      try {
        let originalTree: any | undefined;
        if (op.type === OpType.OVERWRITE) {
          const originalContent = await this.deps.loadOriginalContent(args.workPath, op.path);
          if (typeof originalContent === 'string') {
            try {
              originalTree = await this.deps.parse(originalContent, lang);
            } catch {
              // Ignore original parse failures; only the proposed tree is required.
            }
          }
        }

        const proposedTree = await this.deps.parse(op.content.toString('utf8'), lang);

        if (originalTree) {
          const validationResult = this.deps.validateScopeIntegrity(
            originalTree,
            proposedTree,
            targetNodeName,
          );

          if (!validationResult.ok) {
            return {
              ok: false,
              filePath: op.path,
              error: `AST Scope Integrity failed for ${op.path}: ${validationResult.reason}`,
            };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
