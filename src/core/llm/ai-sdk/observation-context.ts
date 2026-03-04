import { getAuditContext, setAuditContext } from '../../observability/audit-trail.js';

/**
 * Temporarily overrides audit observationName for the given async operation,
 * and always restores the previous value.
 */
export async function withAuditObservationName<T>(
  observationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousObservationName = getAuditContext().observationName;
  setAuditContext({ observationName });
  try {
    return await operation();
  } finally {
    setAuditContext({ observationName: previousObservationName });
  }
}
