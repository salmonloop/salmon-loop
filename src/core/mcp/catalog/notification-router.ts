export type McpCatalogKind = 'tools' | 'resources' | 'resourceTemplates' | 'prompts';

export interface McpCatalogInvalidation {
  serverName: string;
  kind: McpCatalogKind;
}

export class McpNotificationRouter {
  private handlers: Array<(event: McpCatalogInvalidation) => void | Promise<void>> = [];

  onInvalidate(handler: (event: McpCatalogInvalidation) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  async invalidate(event: McpCatalogInvalidation): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  async route(input: { serverName: string; method: string }): Promise<boolean> {
    const kind = this.kindForMethod(input.method);
    if (!kind) return false;
    await this.invalidate({ serverName: input.serverName, kind });
    return true;
  }

  kindForMethod(method: string): McpCatalogKind | null {
    if (method === 'notifications/tools/list_changed') return 'tools';
    if (method === 'notifications/resources/list_changed') return 'resources';
    if (method === 'notifications/prompts/list_changed') return 'prompts';
    if (method === 'tools/list_changed') return 'tools';
    if (method === 'resources/list_changed') return 'resources';
    if (method === 'prompts/list_changed') return 'prompts';
    return null;
  }
}
