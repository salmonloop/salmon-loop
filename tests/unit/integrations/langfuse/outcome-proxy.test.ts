import { describe, expect, it } from 'bun:test';

import { resolveLangfuseOutcomeProxyBaseUrl } from '../../../../src/integrations/langfuse/outcome-proxy.js';

describe('resolveLangfuseOutcomeProxyBaseUrl', () => {
  it('should return disabled if enabled is false', () => {
    const result = resolveLangfuseOutcomeProxyBaseUrl({ enabled: false });
    expect(result).toEqual({ enabled: false, reason: 'DISABLED' });
  });

  it('should return disabled if enabled is undefined', () => {
    const result = resolveLangfuseOutcomeProxyBaseUrl({});
    expect(result).toEqual({ enabled: false, reason: 'DISABLED' });
  });

  describe('when endpoint is provided', () => {
    it('should parse a basic endpoint without a path', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: 'https://langfuse.example.com',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'https://langfuse.example.com',
        proxyPathPrefix: '/langfuse',
      });
    });

    it('should parse an endpoint with /langfuse', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: 'https://langfuse.example.com/langfuse',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'https://langfuse.example.com',
        proxyPathPrefix: '/langfuse',
      });
    });

    it('should parse an endpoint with /api/public suffix and remove it', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: 'https://langfuse.example.com/my-prefix/api/public',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'https://langfuse.example.com',
        proxyPathPrefix: '/my-prefix',
      });
    });

    it('should parse an endpoint with /api/public/ingestion suffix and remove it', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: 'https://langfuse.example.com/my-prefix/api/public/ingestion',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'https://langfuse.example.com',
        proxyPathPrefix: '/my-prefix',
      });
    });

    it('should return MISSING_PROXY_URL if endpoint is invalid URL', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: 'not-a-url',
      });
      expect(result).toEqual({
        enabled: true,
        reason: 'MISSING_PROXY_URL',
      });
    });

    it('should return PUBLIC_PROVIDER_HOST if endpoint points to a public LLM provider', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: 'https://api.openai.com/v1',
      });
      expect(result).toEqual({
        enabled: true,
        reason: 'PUBLIC_PROVIDER_HOST',
      });
    });
  });

  describe('when no endpoint but llmBaseUrl is provided', () => {
    it('should derive proxy from an llmBaseUrl that ends with /v1', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        llmBaseUrl: 'http://localhost:4000/v1',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'http://localhost:4000',
        proxyPathPrefix: '/langfuse',
      });
    });

    it('should derive proxy from an llmBaseUrl that ends with /v1/', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        llmBaseUrl: 'http://localhost:4000/v1/',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'http://localhost:4000',
        proxyPathPrefix: '/langfuse',
      });
    });

    it('should derive proxy from an llmBaseUrl without /v1', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        llmBaseUrl: 'http://localhost:4000',
      });
      expect(result).toEqual({
        enabled: true,
        proxyBaseUrl: 'http://localhost:4000',
        proxyPathPrefix: '/langfuse',
      });
    });

    it('should return PUBLIC_PROVIDER_HOST if derived url points to a public LLM provider', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        llmBaseUrl: 'https://api.anthropic.com/v1',
      });
      expect(result).toEqual({
        enabled: true,
        reason: 'PUBLIC_PROVIDER_HOST',
      });
    });
  });

  describe('when neither endpoint nor llmBaseUrl is provided', () => {
    it('should return MISSING_PROXY_URL', () => {
      const result = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: true,
        endpoint: '',
        llmBaseUrl: '  ',
      });
      expect(result).toEqual({
        enabled: true,
        reason: 'MISSING_PROXY_URL',
      });
    });
  });
});
