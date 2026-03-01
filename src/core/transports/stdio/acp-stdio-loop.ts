import { createInterface } from 'readline';

import { isAcpJsonRpcError, type AcpJsonRpcResponse } from '../../protocols/acp/index.js';

const PARSE_ERROR = -32700;
const INTERNAL_ERROR = -32603;

function writeJson(
  stream: NodeJS.WritableStream,
  payload: AcpJsonRpcResponse | Record<string, unknown>,
) {
  stream.write(`${JSON.stringify(payload)}\n`);
}

function buildErrorResponse(params: {
  id: unknown;
  code: number;
  message: string;
  data?: Record<string, unknown>;
}): AcpJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: params.id === undefined ? null : (params.id as any),
    error: {
      code: params.code,
      message: params.message,
      data: params.data,
    },
  };
}

export function createAcpStdioLoop(input: {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  errorOutput?: NodeJS.WritableStream;
  handler: {
    handle: (request: unknown) => Promise<AcpJsonRpcResponse | null>;
  };
}) {
  const rl = createInterface({
    input: input.input,
    crlfDelay: Infinity,
    terminal: false,
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let payload: unknown;

    try {
      payload = JSON.parse(line);
    } catch (error) {
      writeJson(
        input.output,
        buildErrorResponse({
          id: null,
          code: PARSE_ERROR,
          message: 'Parse error',
        }),
      );
      input.errorOutput?.write(`ACP parse error: ${String(error)}\n`);
      return;
    }

    try {
      const response = await input.handler.handle(payload);
      if (response) {
        writeJson(input.output, response);
      }
    } catch (error) {
      const id =
        payload && typeof payload === 'object' && 'id' in (payload as Record<string, unknown>)
          ? (payload as Record<string, unknown>).id
          : null;

      if (isAcpJsonRpcError(error)) {
        writeJson(
          input.output,
          buildErrorResponse({
            id,
            code: error.code,
            message: error.message,
            data: error.data,
          }),
        );
        return;
      }

      writeJson(
        input.output,
        buildErrorResponse({
          id,
          code: INTERNAL_ERROR,
          message: 'Internal error',
        }),
      );
      input.errorOutput?.write(`ACP handler error: ${String(error)}\n`);
    }
  });

  return {
    close() {
      rl.close();
    },
  };
}
