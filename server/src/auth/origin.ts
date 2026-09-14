import type { FastifyReply, FastifyRequest } from "fastify";

import { bearerToken } from "./guard.js";
import { SESSION_COOKIE_NAME } from "./session.js";

/**
 * CSRF protection, second half.
 *
 * The first half is the session cookie's `SameSite=Lax`, which keeps browsers
 * from attaching it to a cross-site POST at all. This is the server-side check
 * that does not depend on the browser getting that right: a request that
 * changes state, or opens the WebSocket, must either say which origin it came
 * from and name ours, or say nothing at all.
 *
 * "Or say nothing at all" is deliberate. Browsers have sent `Origin` on every
 * cross-origin request for years, so a missing header means the caller is not
 * a browser page (curl, a script, a health check) and cannot be a
 * cross-site-request forgery in the first place, while insisting on the header
 * would break every non-browser client for no gain. A header that *is* there
 * and points somewhere else is refused, no matter how it got there.
 *
 * A request that proves itself with an access token in the Authorization
 * header and carries no session cookie is not a forgery case at all: a
 * browser attaches cookies on its own, but never a custom header, so a
 * cross-site page cannot make a request look like this. Such requests skip
 * the check (the token itself is still verified by the session guard).
 */

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Where the request believes it arrived. With `trustProxy` on (the documented
 * deployment), Fastify derives both from `X-Forwarded-Proto`/`X-Forwarded-Host`,
 * so this is the address the browser actually typed, not the container's.
 */
function selfOrigin(request: FastifyRequest): string | null {
  // Through URL so the comparison is between normalized origins: a browser
  // drops the default port from the Origin header, the Host header keeps it.
  return originOf(`${request.protocol}://${request.host}`);
}

function originOf(rawValue: string): string | null {
  try {
    const url = new URL(rawValue);

    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin a request claims, from `Origin` or, when that is absent, from
 * `Referer`. Null means neither header was usable.
 */
function claimedOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;

  if (typeof origin === "string" && origin.length > 0) {
    // Some clients send the literal "null" origin (sandboxed iframe, a
    // file:// page); that is never us.
    return origin === "null" ? "null" : originOf(origin);
  }

  const referer = request.headers.referer;

  if (typeof referer === "string" && referer.length > 0) {
    return originOf(referer);
  }

  return null;
}

function isAllowedOrigin(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  const claimed = claimedOrigin(request);

  if (claimed === null) {
    return true;
  }

  const self = selfOrigin(request);

  return (self !== null && claimed === self) || allowedOrigins.includes(claimed);
}

function isTokenOnlyRequest(request: FastifyRequest): boolean {
  return bearerToken(request) !== null && request.cookies[SESSION_COOKIE_NAME] === undefined;
}

function needsOriginCheck(request: FastifyRequest): boolean {
  if (isTokenOnlyRequest(request)) {
    return false;
  }

  if (STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  // The WebSocket handshake is a GET, and a cross-site one would still carry
  // the cookie in browsers that scope SameSite differently for upgrades.
  return String(request.headers.upgrade ?? "").toLowerCase() === "websocket";
}

/**
 * onRequest hook. Mounted once for the whole app so a route added later is
 * covered by default rather than by remembering to opt in.
 */
export function createOriginGuard(allowedOrigins: readonly string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!needsOriginCheck(request) || isAllowedOrigin(request, allowedOrigins)) {
      return;
    }

    request.log.warn({ origin: request.headers.origin, referer: request.headers.referer }, "rejected cross-origin request");

    await reply.code(403).send({
      error: "forbidden_origin",
      message: "This request came from another site."
    });
  };
}
