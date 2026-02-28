export class A2AJsonRpcError extends Error {
  readonly code: number;
  readonly status: number;

  constructor(params: { code: number; message: string; status: number }) {
    super(params.message);
    this.name = 'A2AJsonRpcError';
    this.code = params.code;
    this.status = params.status;
  }
}

export function isA2AJsonRpcError(error: unknown): error is A2AJsonRpcError {
  return error instanceof A2AJsonRpcError;
}
