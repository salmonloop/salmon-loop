/**
 * @fileoverview Prevent hardcoded language-specific logic
 * @author salmon-loop
 *
 * This rule enforces the architectural principle that all language-specific
 * behavior must come from LanguagePlugin implementations via pluginRegistry.
 *
 * @see docs/design/language-hardcoding-prevention.md
 */

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevent hardcoded language checks. Use pluginRegistry or langOrchestrator instead.',
      category: 'Architecture',
      recommended: 'error',
      url: 'https://github.com/salmon-loop/salmon-loop/blob/main/docs/design/language-hardcoding-prevention.md',
    },
    messages: {
      hardcodedLanguage:
        'Hardcoded language check "{{language}}" detected. ' +
        'Use pluginRegistry.getById() or langOrchestrator.getASTQuery() instead.',
      hardcodedExtensionArray:
        'Hardcoded extension array "{{name}}" detected. ' +
        'Use pluginRegistry.getAll() to get extensions dynamically.',
      hardcodedLanguageArray:
        'Hardcoded language array detected. ' +
        'Use pluginRegistry.getAll() to get languages dynamically.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          whitelist: {
            type: 'array',
            items: { type: 'string' },
            default: [],
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const whitelist = options.whitelist || [];

    // Known hardcoded languages
    const hardcodedLanguages = new Set([
      'typescript',
      'tsx',
      'javascript',
      'jsx',
      'python',
      'go',
      'rust',
      'java',
      'c',
      'cpp',
      'csharp',
      'php',
      'ruby',
      'swift',
      'kotlin',
      'scala',
    ]);

    // Forbidden variable names for extension arrays
    const forbiddenExtensionArrays = new Set([
      'EXT_CANDIDATES',
      'INDEX_CANDIDATES',
      'EXTENSIONS',
      'FILE_EXTENSIONS',
      'LANG_EXTENSIONS',
    ]);

    // Check if file is whitelisted
    const filename = context.getFilename();
    const isWhitelisted = whitelist.some((pattern) => filename.includes(pattern));

    if (isWhitelisted) {
      return {};
    }

    return {
      // Detect: if (lang === 'typescript')
      BinaryExpression(node) {
        if (node.operator === '===' || node.operator === '!==') {
          const { left, right } = node;

          const checkHardcodedLanguage = (identifier, literal) => {
            if (
              identifier.type === 'Identifier' &&
              (identifier.name === 'lang' ||
                identifier.name === 'language' ||
                identifier.name === 'langId') &&
              literal.type === 'Literal' &&
              typeof literal.value === 'string' &&
              hardcodedLanguages.has(literal.value.toLowerCase())
            ) {
              return literal.value.toLowerCase();
            }
            return null;
          };

          const foundLang =
            checkHardcodedLanguage(left, right) || checkHardcodedLanguage(right, left);

          if (foundLang) {
            context.report({
              node,
              messageId: 'hardcodedLanguage',
              data: { language: foundLang },
            });
          }
        }
      },

      // Detect: const EXT_CANDIDATES = ['.ts', '.js']
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier') {
          const name = node.id.name;

          // Check for forbidden extension array names
          if (forbiddenExtensionArrays.has(name)) {
            context.report({
              node,
              messageId: 'hardcodedExtensionArray',
              data: { name },
            });
          }
        }
      },

      // Detect: ['typescript', 'javascript', 'python']
      ArrayExpression(node) {
        // Only flag arrays that contain only string literals of languages
        if (node.elements.length < 2) return;

        const allLanguageStrings = node.elements.every((el) => {
          if (el.type !== 'Literal' || typeof el.value !== 'string') return false;
          return hardcodedLanguages.has(el.value.toLowerCase());
        });

        if (allLanguageStrings) {
          // Find parent to provide context
          const parent = node.parent;
          if (parent && parent.type === 'VariableDeclarator') {
            context.report({
              node,
              messageId: 'hardcodedLanguageArray',
            });
          }
        }
      },
    };
  },
};

export default rule;
