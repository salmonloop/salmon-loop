export class SalmonError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class GitError extends SalmonError {
  constructor(
    message: string,
    public readonly command?: string,
    public readonly stderr?: string,
  ) {
    const fullMessage = stderr ? `${message}\nStderr: ${stderr}` : message;
    super(fullMessage, 'GIT_ERROR');
  }
}

export class DiffValidationError extends SalmonError {
  constructor(message: string) {
    super(message, 'DIFF_VALIDATION_FAILED');
  }
}
