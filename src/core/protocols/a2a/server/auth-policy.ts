export interface A2AAuthContext {
  scheme: 'bearer';
  subject: string;
}

export type A2AAuthenticationResult =
  | { authenticated: true; authContext: A2AAuthContext }
  | { authenticated: false; status: 401; message: string };

export type A2APolicyDecision =
  | { allowed: true }
  | { allowed: false; status: 403; message: string };

export interface A2AAuthenticator {
  authenticate(request: Request): Promise<A2AAuthenticationResult>;
}

export interface A2APolicy {
  authorize(input: { request: Request; authContext: A2AAuthContext }): Promise<A2APolicyDecision>;
}

export type A2AAccessDecision =
  | { allowed: true; authContext: A2AAuthContext }
  | { allowed: false; status: 401 | 403; message: string };

export interface A2AAuthPolicyMiddleware {
  authorize(request: Request): Promise<A2AAccessDecision>;
}

export function createBearerTokenAuthenticator(deps: { tokens: string[] }): A2AAuthenticator {
  const allowedTokens = new Set(deps.tokens);

  return {
    async authenticate(request) {
      const header = request.headers.get('authorization');
      if (!header) {
        return { authenticated: false, status: 401, message: 'Missing bearer token' };
      }

      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return { authenticated: false, status: 401, message: 'Invalid bearer token' };
      }

      if (!allowedTokens.has(token)) {
        return { authenticated: false, status: 401, message: 'Invalid bearer token' };
      }

      return {
        authenticated: true,
        authContext: {
          scheme: 'bearer',
          subject: token,
        },
      };
    },
  };
}

export function createAllowAllA2APolicy(): A2APolicy {
  return {
    async authorize() {
      return { allowed: true };
    },
  };
}

export function createA2AAuthPolicyMiddleware(deps: {
  authenticator: A2AAuthenticator;
  policy: A2APolicy;
}): A2AAuthPolicyMiddleware {
  return {
    async authorize(request) {
      const authenticated = await deps.authenticator.authenticate(request);
      if (!authenticated.authenticated) {
        return {
          allowed: false,
          status: authenticated.status,
          message: authenticated.message,
        };
      }

      const decision = await deps.policy.authorize({
        request,
        authContext: authenticated.authContext,
      });
      if (!decision.allowed) {
        return {
          allowed: false,
          status: decision.status,
          message: decision.message,
        };
      }

      return {
        allowed: true,
        authContext: authenticated.authContext,
      };
    },
  };
}
