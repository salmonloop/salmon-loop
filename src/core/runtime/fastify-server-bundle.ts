export type FastifyListenOptions = {
  port?: number;
  host?: string;
  path?: string;
};

export type FastifyServerLike = {
  route: (...args: any[]) => any;
  register: (...args: any[]) => any;
  listen: (...args: any[]) => any;
  close: (...args: any[]) => any;
};

export type FastifyFactory = () => FastifyServerLike;

export function createFastifyServerBundle(deps: {
  createFastify: FastifyFactory;
  a2aPlugin: (instance: FastifyServerLike) => Promise<void> | void;
  sidecarPlugin: (instance: FastifyServerLike) => Promise<void> | void;
  configureA2A?: (instance: FastifyServerLike) => Promise<void> | void;
  configureSidecar?: (instance: FastifyServerLike) => Promise<void> | void;
  a2aListen: FastifyListenOptions;
  sidecarListen: FastifyListenOptions;
}) {
  const a2aServer = deps.createFastify();
  const sidecarServer = deps.createFastify();

  async function start(): Promise<void> {
    if (deps.configureA2A) {
      await deps.configureA2A(a2aServer);
    }
    await a2aServer.register(deps.a2aPlugin);

    if (deps.configureSidecar) {
      await deps.configureSidecar(sidecarServer);
    }
    await sidecarServer.register(deps.sidecarPlugin);

    await a2aServer.listen(deps.a2aListen);
    await sidecarServer.listen(deps.sidecarListen);
  }

  async function close(): Promise<void> {
    await Promise.all([a2aServer.close(), sidecarServer.close()]);
  }

  return {
    a2aServer,
    sidecarServer,
    start,
    close,
  };
}
