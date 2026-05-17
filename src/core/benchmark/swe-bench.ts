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
