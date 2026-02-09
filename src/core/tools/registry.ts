import { TOOL_INTENTS, ToolSpec } from './types.js';

export class ToolRegistry {
  private specs = new Map<string, ToolSpec>();

  /**
   * Register standard tool specification (including executor)
   */
  register(spec: ToolSpec) {
    if (this.specs.has(spec.name)) {
      throw new Error(`Tool ${spec.name} is already registered`);
    }
    if (!TOOL_INTENTS.includes(spec.intent)) {
      throw new Error(`Tool ${spec.name} must declare a valid intent`);
    }
    this.specs.set(spec.name, spec);
  }

  getSpec(name: string): ToolSpec | undefined {
    return this.specs.get(name);
  }

  listAll(): ToolSpec[] {
    return Array.from(this.specs.values());
  }

  /**
   * Clear all tools (mainly used for testing)
   */
  clear() {
    this.specs.clear();
  }
}
