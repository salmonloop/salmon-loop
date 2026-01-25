import { ToolSpec } from './types';

export class ToolRegistry {
  private specs = new Map<string, ToolSpec>();

  /**
   * 注册标准工具规范（含 executor）
   */
  register(spec: ToolSpec) {
    if (this.specs.has(spec.name)) {
      throw new Error(`Tool ${spec.name} is already registered`);
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
   * 清除所有工具（主要用于测试）
   */
  clear() {
    this.specs.clear();
  }
}
