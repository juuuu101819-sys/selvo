import { describe, expect, it } from 'vitest';
import {
  alignLoopbackRewrite,
  hostnameFromHostHeader,
  isLoopbackHostname,
  isSamePathLocation,
} from './rewrite-host';

describe('alignLoopbackRewrite', () => {
  it('moves a localhost rewrite onto a 127.0.0.1 Host header', () => {
    expect(alignLoopbackRewrite('http://localhost:43117/en', '127.0.0.1:43117')).toBe(
      'http://127.0.0.1:43117/en',
    );
  });

  it('keeps a matching loopback rewrite unchanged', () => {
    expect(alignLoopbackRewrite('http://localhost:43217/en', 'localhost:43217')).toBe(
      'http://localhost:43217/en',
    );
  });

  it('does not rewrite a public origin onto the incoming host', () => {
    expect(alignLoopbackRewrite('https://cdn.example/en', '127.0.0.1:43117')).toBe(
      'https://cdn.example/en',
    );
  });

  it('returns invalid rewrite strings unchanged', () => {
    expect(alignLoopbackRewrite('/en', '127.0.0.1:43117')).toBe('/en');
  });
});

describe('loopback host helpers', () => {
  it('parses host headers', () => {
    expect(hostnameFromHostHeader('127.0.0.1:43117')).toBe('127.0.0.1');
    expect(hostnameFromHostHeader('localhost')).toBe('localhost');
    expect(hostnameFromHostHeader('[::1]:43117')).toBe('::1');
  });

  it('recognizes loopback names', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('example.com')).toBe(false);
  });
});

describe('isSamePathLocation', () => {
  const requestUrl = new URL('http://127.0.0.1:43117/');

  it('treats Location: / as the same path', () => {
    expect(isSamePathLocation('/', requestUrl)).toBe(true);
  });

  it('does not treat a locale prefix as the same path', () => {
    expect(isSamePathLocation('/ko', requestUrl)).toBe(false);
  });
});
