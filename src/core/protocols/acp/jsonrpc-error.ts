export class AcpJsonRpcError extends Error {
  readonly code: number;
  readonly data?: Record<string, unknown>;

  constructor(input: { code: number; message: string; data?: Record<string, unknown> }) {
    super(input.message);
    this.name = 'AcpJsonRpcError';
    this.code = input.code;
    this.data = input.data;
  }
}

export function isAcpJsonRpcError(error: unknown): error is AcpJsonRpcError {
  return error instanceof AcpJsonRpcError;
}
