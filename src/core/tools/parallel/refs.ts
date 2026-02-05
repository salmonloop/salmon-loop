export type OutputRef =
  | { $ref: 'nodeOutput'; nodeId: string }
  | { $ref: 'nodeOutputPath'; nodeId: string; path: string };

export function isOutputRef(v: any): v is OutputRef {
  return (
    v !== null &&
    typeof v === 'object' &&
    (v.$ref === 'nodeOutput' || v.$ref === 'nodeOutputPath') &&
    typeof v.nodeId === 'string'
  );
}
