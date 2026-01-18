# Salmon-Loop

[English](../README.md) | [简体中文](README.zh-CN.md)

一个用于自动化代码补丁的最小可行执行循环。

## 设计理念

Salmon-Loop 是一个 CLI 工具，实现了自动化代码补丁的最小可行执行循环。它的设计目标是可扩展和灵活，允许用户根据特定需求定制循环流程。

## 使用方法

使用 Salmon-Loop，只需运行 `salmon-loop run` 命令并附带所需选项。例如：

```bash
salmon-loop run --verify "npm test" --scope "current-file" --instruction "fix bug" --target-path "src/buggy-file.ts"
```

这将运行带有以下选项的循环：

* `--verify "npm test"`：运行 `npm test` 命令验证更改
* `--scope "current-file"`：仅考虑当前文件中的更改
* `--instruction "fix bug"`：使用 "fix bug" 指令生成补丁
* `--target-path "src/buggy-file.ts"`：将补丁应用到 `src/buggy-file.ts` 文件

## 限制

* 仅支持 unified diff 格式的补丁
* 仅支持有限数量的文件和行数
* 不支持重构或格式化更改
* 不支持添加或删除文件

## 贡献

如需为 Salmon-Loop 做出贡献，请 fork 此仓库并提交包含您更改的 pull request。请务必包含清晰的更改描述和必要性说明。

## 许可证

Salmon-Loop 使用 MIT 许可证。