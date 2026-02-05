import { NodeResult } from './plan.js';
import { isOutputRef, OutputRef } from './refs.js';

/**
 * Resolves a path within an object (e.g., "a.b[0].c")
 */
function getValueAtPath(obj: any, path: string): any {
  if (!path) return obj;

  const parts = path.split(/[.[\]]+/).filter(Boolean);
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Recursively resolves OutputRef instances in an arguments object
 * using the results from previously executed nodes.
 */
export function resolveArgsWithResults(args: any, results: Record<string, NodeResult>): any {
  if (isOutputRef(args)) {
    const ref = args as OutputRef;
    const nodeResult = results[ref.nodeId];

    if (!nodeResult) {
      throw new Error(`Reference to unknown node: ${ref.nodeId}`);
    }

    if (nodeResult.status !== 'SUCCEEDED') {
      throw new Error(`Reference to node ${ref.nodeId} which has status ${nodeResult.status}`);
    }

    if (ref.$ref === 'nodeOutput') {
      return nodeResult.output;
    } else {
      return getValueAtPath(nodeResult.output, ref.path);
    }
  }

  if (Array.isArray(args)) {
    return args.map((item) => resolveArgsWithResults(item, results));
  }

  if (args !== null && typeof args === 'object') {
    const resolved: any = {};
    for (const [key, value] of Object.entries(args)) {
      resolved[key] = resolveArgsWithResults(value, results);
    }
    return resolved;
  }

  return args;
}
