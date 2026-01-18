# Salmon-Loop

[English](README.md) | [简体中文](docs/README.zh-CN.md)

A minimal viable execution loop for automated code patching.

## Design Philosophy

Salmon-Loop is a CLI tool that implements a minimal viable execution loop for automated code patching. It is designed to be extensible and flexible, allowing users to customize the loop to fit their specific needs.

## Usage

To use Salmon-Loop, simply run the command `salmon-loop run` with the desired options. For example:

```bash
salmon-loop run --verify "npm test" --scope "current-file" --instruction "fix bug" --target-path "src/buggy-file.ts"
```

This will run the loop with the following options:

* `--verify "npm test"`: Run the `npm test` command to verify the changes.
* `--scope "current-file"`: Only consider changes in the current file.
* `--instruction "fix bug"`: Use the instruction "fix bug" to generate the patch.
* `--target-path "src/buggy-file.ts"`: Apply the patch to the file `src/buggy-file.ts`.

## Limitations

* Only supports unified diff format patches.
* Only supports a limited number of files and lines in the patch.
* Does not support refactoring or formatting changes.
* Does not support adding or deleting files.

## Contributing

To contribute to Salmon-Loop, please fork the repository and submit a pull request with your changes. Make sure to include a clear description of your changes and why they are necessary.

## License

Salmon-Loop is licensed under the MIT license.
