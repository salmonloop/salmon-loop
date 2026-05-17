export interface SweBenchPredictionInput {
  instanceId: string;
  modelNameOrPath: string;
  modelPatch: string;
}

export interface SweBenchPrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

export function buildSweBenchPrediction(input: SweBenchPredictionInput): SweBenchPrediction {
  return {
    instance_id: input.instanceId,
    model_name_or_path: input.modelNameOrPath,
    model_patch: input.modelPatch,
  };
}

export function encodeSweBenchPredictionJsonl(input: SweBenchPredictionInput): string {
  return `${JSON.stringify(buildSweBenchPrediction(input))}\n`;
}

export interface SweBenchInstance {
  instance_id: string;
  repo?: string;
  base_commit?: string;
  problem_statement?: string;
  [key: string]: unknown;
}

export function parseSweBenchInstance(raw: string): SweBenchInstance {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SWE-bench instance must be a JSON object.');
  }

  const instance = parsed as Record<string, unknown>;
  if (typeof instance.instance_id !== 'string' || !instance.instance_id.trim()) {
    throw new Error('SWE-bench instance requires a non-empty instance_id.');
  }

  return {
    ...instance,
    instance_id: instance.instance_id,
  } as SweBenchInstance;
}
