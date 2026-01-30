import { SalmonError } from '../types.js';

export class ConfigError extends SalmonError {
  constructor(
    code: string,
    public readonly details?: Record<string, string>,
  ) {
    // The message is intentionally not user-facing; CLI formats localized text using `code` + `details`.
    super(code, code);
    this.name = 'ConfigError';
  }
}
