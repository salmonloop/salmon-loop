import { describe, expect, test } from 'bun:test';

import {
  buildSidecarRouteDescriptors,
  defaultSidecarRouteCatalog,
} from '../../../../src/core/runtime/sidecar-route-catalog.js';

describe('sidecar route catalog', () => {
  test('builds descriptors from catalog and handlers', async () => {
    const descriptors = buildSidecarRouteDescriptors({
      catalog: [
        {
          id: 'health',
          method: 'GET',
          path: '/health',
          exposure: 'essential',
          scope: 'uds',
          policyTag: 'sidecar.health.read',
        },
      ],
      handlers: {
        health: async () => new Response('ok'),
      },
    });

    expect(descriptors).toEqual([
      {
        method: 'GET',
        path: '/health',
        exposure: 'essential',
        scope: 'uds',
        policyTag: 'sidecar.health.read',
        handler: expect.any(Function),
      },
    ]);
  });

  test('throws when handlers are missing in strict mode', () => {
    expect(() =>
      buildSidecarRouteDescriptors({
        catalog: [
          {
            id: 'status',
            method: 'GET',
            path: '/status',
            exposure: 'essential',
            scope: 'uds',
            policyTag: 'sidecar.status.read',
          },
        ],
        handlers: {},
        strict: true,
      }),
    ).toThrow('Missing sidecar handler: status');
  });

  test('default catalog avoids A2A/sidecar prefixes', () => {
    const prefixed = defaultSidecarRouteCatalog.filter(
      (route) => route.path.startsWith('/a2a') || route.path.startsWith('/sidecar'),
    );
    expect(prefixed).toHaveLength(0);
  });
});
