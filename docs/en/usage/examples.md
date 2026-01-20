# Usage Examples

Here are some common scenarios for using SalmonLoop.

## 1. Basic Bug Fix

Fix a null pointer exception and verify with the test suite:

```bash
salmon-loop --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

## 2. Dry Run (Preview Changes)

Generate a patch without applying it, useful for previewing what the LLM intends to do:

```bash
salmon-loop --instruction "Add logging to auth service" --verify "npm run build" --dry-run --verbose
```

## 3. Targeted Context

Provide a specific file as context to reduce noise and improve accuracy:

```bash
salmon-loop --instruction "Update email validation regex" --verify "jest tests/email.test.ts" --file "src/utils/validation.ts"
```

## 4. Complex Fix with Multiple Retries

SalmonLoop will automatically retry and shrink context if the first attempt fails:

```bash
salmon-loop --instruction "Refactor the database connection pool to use a singleton" --verify "npm run integration-tests"
```

## 5. Deep AST Verification

Ensure only a specific function is modified and no syntax errors are introduced:

```bash
salmon-loop --instruction "Optimize the calculateTotal function" --verify "npm test" --file "src/utils/math.ts" --target-node "calculateTotal"
```
