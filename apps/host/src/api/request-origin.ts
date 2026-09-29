/** Reconstruct the browser-visible origin only for a known local reverse proxy. */
export function resolveRequestOrigin(input: {
  requestUrl: string;
  peerIsLoopback: boolean;
  forwardedProto?: string | null;
  forwardedHost?: string | null;
}): string | null {
  let direct: string;
  try {
    direct = new URL(input.requestUrl).origin;
  } catch {
    return null;
  }
  if (!input.peerIsLoopback) return direct;

  const proto = input.forwardedProto;
  const host = input.forwardedHost;
  if (proto == null && host == null) return direct;
  if (proto == null || host == null) return null;
  if (!/^(http|https)$/i.test(proto)) return null;
  // A single DNS/IPv4 host with an optional numeric port, or a bracketed IPv6
  // address. URL parsing below checks the address and port ranges.
  if (!/^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9a-fA-F:.]+\])(?::[0-9]{1,5})?$/.test(host)) return null;
  try {
    const url = new URL(`${proto.toLowerCase()}://${host}`);
    if (url.origin === "null" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
