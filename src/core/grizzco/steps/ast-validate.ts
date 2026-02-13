import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { AstParser, validateScopeIntegrity } from '../../ast/index.js';
import { convertDiffToShadowOperations } from '../../diff.js';
import { OpType } from '../domain/grizzco-types.js';
import { Step } from '../engine/pipeline/pipeline.js';
import { AstValidateCtx, ValidateCtx } from '../engine/pipeline/types.js';

export const validateAst: Step<ValidateCtx, AstValidateCtx> = async (ctx) => {
  const { workspace, diff } = ctx;

  // 1. Convert diff to operations to get proposed content
  const operations = await convertDiffToShadowOperations(diff);

  const git = new GitAdapter(workspace.workPath);
  let astValid = true;
  let astError: string | undefined;

  for (const op of operations) {
    if (op.type === OpType.DELETE || op.type === OpType.PATCH) continue;
    if (!op.content) continue; // Cannot validate without content

    // Check extension
    const ext = op.path.split('.').pop()?.toLowerCase();
    let lang: string | undefined;
    if (ext === 'js') lang = 'javascript';
    else if (ext === 'ts') lang = 'typescript';
    else if (ext === 'py') lang = 'python';
    // Add other languages as needed

    if (!lang) continue;

    try {
      // 2. Parse Original (if overwrite/modify)
      let originalTree;
      if (op.type === OpType.OVERWRITE) {
        try {
          const originalContent = await git.show('HEAD', op.path);
          originalTree = await AstParser.parse(originalContent.toString('utf8'), lang);
        } catch {
          // Ignore if original cannot be parsed (maybe binary or ignored)
        }
      }

      // 3. Parse Proposed
      const proposedContent = op.content.toString('utf8');
      const proposedTree = await AstParser.parse(proposedContent, lang);

      // 4. Validate Scope Integrity
      if (originalTree) {
        const validationResult = validateScopeIntegrity(
          originalTree,
          proposedTree,
          ctx.options.targetNodeName || '',
        );

        if (!validationResult.ok) {
          astValid = false;
          astError = `AST Scope Integrity failed for ${op.path}: ${validationResult.reason}`;
          break;
        }
      }

      // Basic syntax check passed if parse didn't throw
    } catch (error: any) {
      astValid = false;
      astError = `AST Syntax Error in ${op.path}: ${error.message}`;
      break;
    }
  }

  if (!astValid) {
    ctx.emit({
      type: 'log',
      level: 'error',
      message: text.loop.astValidationFailed(astError || 'Unknown error'),
      timestamp: new Date(),
    });
    // We choose to abort pipeline if AST is invalid
    throw new Error(astError || text.loop.astValidationFailed('Unknown error'));
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.loop.astValidationPassed,
    timestamp: new Date(),
  });

  return {
    ...ctx,
    astValid,
    astError,
  };
};
