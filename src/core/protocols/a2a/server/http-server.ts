export function createA2AHttpServer(deps: {
  routes: {
    handle: (request: Request) => Promise<Response>;
  };
}) {
  return {
    fetch(request: Request): Promise<Response> {
      return deps.routes.handle(request);
    },
  };
}
