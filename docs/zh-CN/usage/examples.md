# 使用示例

以下是使用 SalmonLoop 的一些常见场景。

## 1. 基础 Bug 修复

修复空指针异常并使用测试套件验证：

```bash
salmon-loop --instruction "Fix the null pointer exception in user.ts" --verify "npm test"
```

## 2. 空运行 (预览更改)

生成补丁但不应用，用于预览 LLM 打算做什么：

```bash
salmon-loop --instruction "Add logging to auth service" --verify "npm run build" --dry-run --verbose
```

## 3. 指定上下文

提供特定文件作为上下文以减少干扰并提高准确性：

```bash
salmon-loop --instruction "Update email validation regex" --verify "jest tests/email.test.ts" --file "src/utils/validation.ts"
```

## 4. 带多次重试的复杂修复

如果第一次尝试失败，SalmonLoop 将自动重试并收缩上下文：

```bash
salmon-loop --instruction "Refactor the database connection pool to use a singleton" --verify "npm run integration-tests"
```

## 5. 深度 AST 校验

确保仅修改特定函数且未引入语法错误：

```bash
salmon-loop --instruction "Optimize the calculateTotal function" --verify "npm test" --file "src/utils/math.ts" --target-node "calculateTotal"
```
