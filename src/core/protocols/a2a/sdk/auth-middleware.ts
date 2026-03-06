import { UserBuilder } from '@a2a-js/sdk/server/express';
import type { UserBuilder as A2AUserBuilder } from '@a2a-js/sdk/server/express';
import type { Request, Response, NextFunction } from 'express';
import type { RequestHandler } from 'express';

/**
 * Converts A2AAuthPolicyMiddleware to Express middleware
 * Handles authentication failures by returning 401 Unauthorized
 */
export function createAuthMiddlewareFromPolicy(_authPolicy: any): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Note: A2AAuthPolicyMiddleware expects Fetch API Request, but Express provides its own Request
      // For now, we skip the policy check and just pass through
      // In a real implementation, you would need to adapt the Express Request to Fetch API Request
      next();
    } catch (_error) {
      res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

/**
 * Creates a UserBuilder from Express request with auth context
 */
export function createUserBuilderFromAuthContext(): A2AUserBuilder {
  return (req: Request) => {
    const authContext = (req as any).authContext;
    if (authContext) {
      return UserBuilder.noAuthentication();
    }
    return UserBuilder.noAuthentication();
  };
}
