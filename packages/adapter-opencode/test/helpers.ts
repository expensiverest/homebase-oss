/** Minimal route-table fake fetch for adapter tests. */

export interface FakeRoute {
  method: string;
  path: string; // pathname, matched exactly
  handler: (request: { url: URL; body: unknown }) => Response | Promise<Response>;
}

export function createFakeFetch(routes: FakeRoute[]): {
  fetchFn: typeof fetch;
  calls: Array<{ method: string; url: URL; body: unknown }>;
} {
  const calls: Array<{ method: string; url: URL; body: unknown }> = [];

  const fetchFn = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url: string }).url;
    const url = new URL(href);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, url, body });

    const route = routes.find((candidate) => candidate.method === method && candidate.path === url.pathname);
    if (!route) {
      return new Response(
        JSON.stringify({ _tag: "NotFoundError", message: `No fake route for ${method} ${url.pathname}` }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return route.handler({ url, body });
  }) as typeof fetch;

  return { fetchFn, calls };
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function errorResponse(status: number, tag: string, message: string): Response {
  return new Response(JSON.stringify({ _tag: tag, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
