export function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];

    if (inSingle) {
      if (c === "'") {
        inSingle = false;
      } else {
        current += c;
      }
    } else if (inDouble) {
      if (c === '"') {
        inDouble = false;
      } else if (
        c === '\\' &&
        i + 1 < command.length &&
        (command[i + 1] === '"' || command[i + 1] === '\\')
      ) {
        current += command[i + 1];
        i++;
      } else {
        current += c;
      }
    } else {
      if (c === "'") {
        inSingle = true;
      } else if (c === '"') {
        inDouble = true;
      } else if (c === '\\' && i + 1 < command.length) {
        current += command[i + 1];
        i++;
      } else if (/\s/.test(c)) {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
      } else {
        current += c;
      }
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
