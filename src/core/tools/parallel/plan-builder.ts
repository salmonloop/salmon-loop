import { ExecutionPlan, ExecutionPolicy, NodeId, PlanNode } from './plan.js';
import { OutputRef } from './refs.js';

export class PlanBuilder {
  private nodes: Map<NodeId, PlanNode> = new Map();
  private dependencies: Map<NodeId, Set<NodeId>> = new Map();

  constructor(private id: string = `plan-${Date.now()}`) {}

  addNode(toolName: string, args: any, id?: NodeId): NodeId {
    const nodeId = id || `node-${this.nodes.size}`;
    if (this.nodes.has(nodeId)) {
      throw new Error(`Node with id ${nodeId} already exists`);
    }
    this.nodes.set(nodeId, {
      id: nodeId,
      toolName,
      args,
      deps: [],
    });
    return nodeId;
  }

  depends(on: NodeId, next: NodeId): this {
    if (!this.nodes.has(on)) throw new Error(`Node ${on} not found`);
    if (!this.nodes.has(next)) throw new Error(`Node ${next} not found`);

    let deps = this.dependencies.get(next);
    if (!deps) {
      deps = new Set();
      this.dependencies.set(next, deps);
    }
    deps.add(on);
    return this;
  }

  parallel(_ids: NodeId[]): this {
    // No explicit dependencies between these nodes
    return this;
  }

  serial(ids: NodeId[]): this {
    for (let i = 0; i < ids.length - 1; i++) {
      this.depends(ids[i], ids[i + 1]);
    }
    return this;
  }

  ref(nodeId: NodeId): OutputRef {
    return { $ref: 'nodeOutput', nodeId };
  }

  refPath(nodeId: NodeId, path: string): OutputRef {
    return { $ref: 'nodeOutputPath', nodeId, path };
  }

  build(policy: ExecutionPolicy): ExecutionPlan {
    const nodes: PlanNode[] = [];

    for (const [id, node] of this.nodes) {
      const deps = Array.from(this.dependencies.get(id) || []);
      nodes.push({
        ...node,
        deps,
      });
    }

    return {
      id: this.id,
      nodes,
      policy,
    };
  }
}
