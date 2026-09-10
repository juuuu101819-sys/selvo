/**
 * Next.js NextURL maps 127.0.0.1 / ::1 to hostname `localhost`. next-intl then rewrites
 * `/` → `http://localhost:<port>/en`. `next dev --hostname 127.0.0.1` records initURL as
 * `http://127.0.0.1:<port>/`, so the router treats that rewrite as external and emits
 * `Location: /` — a 307 loop.
 *
 * When both hosts are loopback, put the rewrite on the Host header the client used so it
 * matches initURL. Production `next start` already uses initURL localhost and does not loop.
 */

const LOOPBACK_HOSTNAME =
  /^(localhost|\[::1\]|::1|127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})$/i;

export function hostnameFromHostHeader(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.lastIndexOf(':');
  if (colon > 0 && host.indexOf(':') === colon) {
    return host.slice(0, colon);
  }
  return host;
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAME.test(hostname);
}

export function alignLoopbackRewrite(rewrite: string, incomingHost: string): string {
  try {
    const rewriteUrl = new URL(rewrite);
    if (rewriteUrl.host === incomingHost) {
      return rewrite;
    }
    if (
      isLoopbackHostname(rewriteUrl.hostname) &&
      isLoopbackHostname(hostnameFromHostHeader(incomingHost))
    ) {
      rewriteUrl.host = incomingHost;
      return rewriteUrl.toString();
    }
    return rewrite;
  } catch {
    return rewrite;
  }
}

export function isSamePathLocation(location: string, requestUrl: URL): boolean {
  try {
    const destination = new URL(location, requestUrl);
    return destination.pathname === requestUrl.pathname && destination.search === requestUrl.search;
  } catch {
    return false;
  }
}
