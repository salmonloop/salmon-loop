import type {
  RouteDescriptor,
  RouteExposure,
  RouteScope,
} from './sidecar-fastify-plugin.js';

export type SidecarRouteSpec = {
  id: string;
  method: string;
  path: string;
  exposure: RouteExposure;
  scope: RouteScope;
  policyTag: string;
};

export type SidecarRouteHandlers = Record<
  string,
  (request: Request) => Promise<Response>
>;

export const defaultSidecarRouteCatalog: SidecarRouteSpec[] = [
  {
    id: 'health',
    method: 'GET',
    path: '/health',
    exposure: 'essential',
    scope: 'uds',
    policyTag: 'sidecar.health.read',
  },
  {
    id: 'status',
    method: 'GET',
    path: '/status',
    exposure: 'essential',
    scope: 'uds',
    policyTag: 'sidecar.status.read',
  },
  {
    id: 'info',
    method: 'GET',
    path: '/info',
    exposure: 'essential',
    scope: 'uds',
    policyTag: 'sidecar.info.read',
  },
  {
    id: 'abort',
    method: 'POST',
    path: '/abort',
    exposure: 'essential',
    scope: 'uds',
    policyTag: 'sidecar.task.abort',
  },
  {
    id: 'workspace_files',
    method: 'GET',
    path: '/workspace/files',
    exposure: 'conditional',
    scope: 'uds',
    policyTag: 'sidecar.workspace.files',
  },
  {
    id: 'logs_stream',
    method: 'GET',
    path: '/logs/stream',
    exposure: 'conditional',
    scope: 'uds',
    policyTag: 'sidecar.logs.stream',
  },
  {
    id: 'config_patch',
    method: 'PATCH',
    path: '/config',
    exposure: 'conditional',
    scope: 'uds',
    policyTag: 'sidecar.config.patch',
  },
  {
    id: 'shutdown',
    method: 'POST',
    path: '/shutdown',
    exposure: 'forbidden',
    scope: 'uds',
    policyTag: 'sidecar.shutdown',
  },
  {
    id: 'config_get',
    method: 'GET',
    path: '/config',
    exposure: 'forbidden',
    scope: 'uds',
    policyTag: 'sidecar.config.read',
  },
  {
    id: 'terminal_exec',
    method: 'POST',
    path: '/terminal/exec',
    exposure: 'forbidden',
    scope: 'uds',
    policyTag: 'sidecar.terminal.exec',
  },
];

export function buildSidecarRouteDescriptors(input: {
  handlers: SidecarRouteHandlers;
  catalog?: SidecarRouteSpec[];
  strict?: boolean;
}): RouteDescriptor[] {
  const catalog = input.catalog ?? defaultSidecarRouteCatalog;
  const descriptors: RouteDescriptor[] = [];
  const missing: string[] = [];

  for (const route of catalog) {
    if (route.exposure === 'forbidden') continue;
    const handler = input.handlers[route.id];
    if (!handler) {
      missing.push(route.id);
      continue;
    }
    const { id: _id, ...descriptor } = route;
    descriptors.push({ ...descriptor, handler });
  }

  if (input.strict && missing.length > 0) {
    throw new Error(`Missing sidecar handler: ${missing[0]}`);
  }

  return descriptors;
}
