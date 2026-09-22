/**
 * Which addresses the LLM proxy may forward to.
 *
 * The proxy exists because a browser tab cannot call the provider itself (CORS,
 * and the API key would have to travel to the tab to try). That turns the
 * server into something that makes outbound requests on behalf of a client,
 * which is the shape of every SSRF hole, so the rule is an allowlist of exact
 * hosts over HTTPS rather than "anything the client asks for".
 *
 * Local providers (Ollama, Jan.ai, LM Studio) are deliberately not reachable
 * here: on a server "localhost" is the container, not the user's machine. The
 * browser talks to those directly, and forwarding to a LAN address is a
 * separate decision that the plan puts after this stage.
 */

export class LlmTargetError extends Error {}

export function assertAllowedTarget(rawUrl: unknown, allowedHosts: readonly string[]): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new LlmTargetError("No target URL given.");
  }

  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new LlmTargetError(`"${rawUrl}" is not a URL.`);
  }

  if (url.protocol !== "https:") {
    throw new LlmTargetError("The AI endpoint must use https.");
  }

  if (url.username || url.password) {
    throw new LlmTargetError("The AI endpoint must not carry credentials.");
  }

  if (url.port && url.port !== "443") {
    throw new LlmTargetError("The AI endpoint must use the standard https port.");
  }

  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new LlmTargetError(
      `${url.hostname} is not an allowed AI endpoint. Add it to SCRIBECAT_LLM_ALLOWED_HOSTS if you run your own gateway.`
    );
  }

  return url;
}

/**
 * Request headers the proxy passes on. An allowlist, so nothing the browser
 * attaches on its own (cookies, origin, the session) can leak to the provider,
 * and nothing about our own transport (encoding, length, connection) confuses
 * the upstream.
 */
const FORWARDED_REQUEST_HEADERS = new Set([
  "content-type",
  "accept",
  "authorization",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "openai-organization",
  "openai-project",
  "openai-beta"
]);

export function forwardableRequestHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || !FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      continue;
    }

    result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }

  return result;
}

/**
 * Response headers handed back to the browser. Content-length and the encoding
 * headers stay behind: fetch has already decoded the body, so repeating the
 * upstream's numbers would describe a body that no longer exists.
 */
const FORWARDED_RESPONSE_HEADERS = new Set(["content-type", "retry-after"]);

export function forwardableResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      result[name.toLowerCase()] = value;
    }
  });

  return result;
}
