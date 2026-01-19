# CLI 使用说明

SalmonLoop 提供了一个命令行界面用于自动化代码补丁。

## 命令

`run` 是默认命令，也是目前唯一的命令。

```bash
salmon-loop [选项]
```

## 选项 (Options)

- `-i, --instruction <string>`: **(必填)** 代码修改指令。
- `-v, --verify <command>`: **(必填)** 用于验证修改的命令（如 `npm test`, `pytest`）。
- `-r, --repo <path>`: 目标仓库路径。默认为当前目录。
- `-f, --file <path>`: 提供作为主要上下文的特定文件路径（相对于仓库或绝对路径）。
- `-s, --selection <text>`: 直接提供文本选择作为上下文。
- `--dry-run`: 生成补丁并运行验证，但不应用到磁盘。
- `--verbose`: 打印详细的步骤日志，包括 LLM 计划和验证输出。
- `--force-reset`: 失败时强制执行硬重置 (`git reset --hard`)。**请谨慎使用**，因为它会丢弃所有未提交的更改。

## 环境变量

- `SALMON_API_KEY`: 您的 LLM 提供商 API 密钥。
- `SALMON_BASE_URL`: (可选) 自定义 API 基础 URL。
- `SALMON_MODEL`: (可选) 要使用的 LLM 模型。
