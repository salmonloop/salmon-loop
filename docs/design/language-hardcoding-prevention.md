# Language Hardcoding Prevention Technical Design

## Overview

This document defines technical safeguards to prevent language-specific hardcoding from re-entering the codebase.

## Problem Statement

Developers may accidentally introduce hardcoded language logic (e.g., `if (lang === 'typescript')`) instead of using the plugin system. This violates the architecture principle of zero hardcoded languages.

## Technical Safeguards

### 1. ESLint Custom Rule (Runtime Prevention)

Create a custom ESLint rule that detects language-specific hardcoded patterns.

**File**: `eslint-rules/no-language-hardcoding.js`

```javascript
/**
 * @fileoverview Prevent hardcoded language-specific logic
 * @author salmon-loop
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent hardcoded language checks like lang === "typescript"',
      category: 'Architecture',
      recommended: 'error',
    },
    messages: {
      hardcodedLanguage: 'Hardcoded language check detected. Use pluginRegistry.getById() or langOrchestrator instead.',
      hardcodedExtension: 'Hardcoded file extension array detected. Use pluginRegistry.getAll() for dynamic extensions.',
    },
    schema: [],
  },
  create(context) {
    // Known hardcoded languages
    const hardcodedLanguages = [
      'typescript', 'tsx', 'javascript', 'jsx', 'python', 'go', 'rust', 'java', 'c', 'cpp'
    ];

    // Known extension arrays pattern
    const extensionArrayPattern = /EXT_CANDIDATES|INDEX_CANDIDATES|EXTENSIONS/;

    return {
      // Detect: if (lang === 'typescript') or lang === 'typescript'
      BinaryExpression(node) {
        if (node.operator === '===' || node.operator === '!==') {
          const { left, right } = node;

          // Check for lang === 'typescript' pattern
          if (
            (left.type === 'Identifier' && left.name === 'lang' &&
             right.type === 'Literal' && hardcodedLanguages.includes(right.value)) ||
            (right.type === 'Identifier' && right.name === 'lang' &&
             left.type === 'Literal' && hardcodedLanguages.includes(left.value))
          ) {
            context.report({
              node,
              messageId: 'hardcodedLanguage',
            });
          }
        }
      },

      // Detect: lang === 'typescript' || lang === 'tsx'
      LogicalExpression(node) {
        const checkNode = (n) => {
          if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '!==')) {
            const { left, right } = n;
            if (
              (left.type === 'Identifier' && left.name === 'lang' &&
               right.type === 'Literal' && hardcodedLanguages.includes(right.value)) ||
              (right.type === 'Identifier' && right.name === 'lang' &&
               left.type === 'Literal' && hardcodedLanguages.includes(left.value))
            ) {
              return true;
            }
          }
          return false;
        };

        if (checkNode(node.left) || checkNode(node.right)) {
          context.report({
            node,
            messageId: 'hardcodedLanguage',
          });
        }
      },

      // Detect: const EXT_CANDIDATES = ['.ts', '.js']
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          extensionArrayPattern.test(node.id.name)
        ) {
          context.report({
            node,
            messageId: 'hardcodedExtension',
          });
        }
      },
    };
  },
};
```

### 2. TypeScript Type Constraints (Compile-time Prevention)

Create a branded type that forces developers to use the plugin system.

**File**: `src/core/types/language.ts`

```typescript
/**
 * Branded type for language identifiers.
 * Cannot be constructed directly - must be obtained from pluginRegistry.
 */
declare const LanguageIdBrand: unique symbol;

export type LanguageId = string & { [LanguageIdBrand]: never };

/**
 * Type guard to check if a string is a valid LanguageId.
 * Only pluginRegistry methods can return valid LanguageId.
 */
export function isLanguageId(value: string): value is LanguageId {
  // Runtime check - must be from a registered plugin
  const { pluginRegistry } = require('../plugin/registry.js');
  return pluginRegistry.getById(value) !== undefined;
}

/**
 * Extension type that cannot be hardcoded.
 */
declare const ExtensionBrand: unique symbol;

export type FileExtension = string & { [ExtensionBrand]: never };
```

### 3. Architecture Decision Record (ADR)

Create an ADR to document this architectural constraint.

**File**: `docs/adr/ADR-XXX-no-language-hardcoding.md`

```markdown
# ADR-XXX: Zero Hardcoded Languages

## Status
Accepted

## Context
The codebase supports multiple programming languages through a plugin system.
Hardcoding language-specific logic violates this architecture.

## Decision
All language-specific behavior MUST be obtained from LanguagePlugin implementations
via pluginRegistry or langOrchestrator. No hardcoded language checks allowed.

## Consequences

### Positive
- New languages automatically supported by adding plugins
- Cleaner, more maintainable code
- Consistent behavior across languages

### Negative
- Slightly more verbose code
- Plugin must be registered before use

## Enforcement

1. ESLint rule: `no-language-hardcoding`
2. Pre-commit hook verification
3. Code review checklist item

## Examples

### ❌ Forbidden
```typescript
if (lang === 'typescript' || lang === 'tsx') {
  queryStr = TS_SPECIFIC_QUERY;
}
```

### ✅ Required
```typescript
const queryStr = await langOrchestrator.getASTQuery(lang, 'definitions');
```
```

### 4. Pre-commit Hook

Add a check to prevent committing hardcoded language patterns.

**File**: `.git/hooks/pre-commit` (or via husky)

```bash
#!/bin/sh

# Check for hardcoded language patterns
echo "Checking for hardcoded language patterns..."

PATTERNS=(
  "lang === 'typescript'"
  "lang === 'javascript'"
  "lang === 'python'"
  "lang === 'go'"
  "lang === 'rust'"
  "EXT_CANDIDATES"
  "INDEX_CANDIDATES"
)

FOUND=0
for pattern in "${PATTERNS[@]}"; do
  if git diff --cached --name-only | xargs grep -l "$pattern" 2>/dev/null; then
    echo "ERROR: Found hardcoded pattern: $pattern"
    echo "Use pluginRegistry or langOrchestrator instead."
    FOUND=1
  fi
done

if [ $FOUND -eq 1 ]; then
  exit 1
fi

exit 0
```

### 5. CI/CD Pipeline Check

Add a step in CI to detect hardcoded languages.

**File**: `.github/workflows/ci.yml` (addition)

```yaml
- name: Check for hardcoded languages
  run: |
    echo "Checking for hardcoded language patterns..."
    ! grep -rn "lang === '" src/ --include="*.ts" || (
      echo "ERROR: Found hardcoded language checks"
      exit 1
    )
    ! grep -rn "EXT_CANDIDATES\|INDEX_CANDIDATES" src/ --include="*.ts" || (
      echo "ERROR: Found hardcoded extension arrays"
      exit 1
    )
```

## Implementation Checklist

- [ ] Create `eslint-rules/no-language-hardcoding.js`
- [ ] Update `eslint.config.js` to include the rule
- [ ] Create `src/core/types/language.ts` branded types
- [ ] Add ADR document
- [ ] Update pre-commit hook
- [ ] Add CI check step

## Whitelist

The following files are exempt from this rule (must have explicit comment explaining why):

1. `src/languages/typescript/index.ts` - TypeScript plugin implementation
2. `src/core/plugin/loader.ts` - Plugin registration (initial bootstrap)
3. Test files that mock language behavior

---

*This document ensures architectural integrity through technical enforcement.*
