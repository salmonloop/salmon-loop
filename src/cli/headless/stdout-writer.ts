export interface StdoutWriter {
  write: (chunk: string) => boolean;
  writeLine: (line: string) => boolean;
  writeJsonLine: (value: unknown) => boolean;
}

export function createStdoutWriter(
  options: { write?: (chunk: string) => boolean } = {},
): StdoutWriter {
  const write = options.write ?? ((chunk) => process.stdout.write(chunk));

  return {
    write,
    writeLine: (line) => write(line + '\n'),
    writeJsonLine: (value) => write(JSON.stringify(value) + '\n'),
  };
}
