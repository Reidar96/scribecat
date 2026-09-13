import { request as httpRequest } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertAllowedTarget, forwardableRequestHeaders, LlmTargetError } from "../src/llm/target.js";
import { KEY_COOKIE_NAME } from "../src/secrets/keyCookie.js";
import { secretRef } from "../src/secrets/secretRef.js";
import { createTestContext, type TestContext } from "./helpers.js";

const ALLOWED = ["api.openai.com", "api.anthropic.com"];

describe("proxy target", () => {
  it("accepts an allowed https host", () => {
    expect(assertAllowedTarget("https://api.openai.com/v1/chat/completions", ALLOWED).hostname).toBe("api.openai.com");
  });

  it("refuses anything else", () => {
    const refused = [
      "http://api.openai.com/v1",
      "https://evil.example/v1",
      "https://api.openai.com.evil.example/v1",
      "http://localhost:11434/api/chat",
      "http://169.254.169.254/latest/meta-data",
      "https://user:pass@api.openai.com/v1",
      "https://api.openai.com:8443/v1",
      "file:///etc/passwd",
      "",
      42
    ];

    for (const target of refused) {
      expect(() => assertAllowedTarget(target, ALLOWED), String(target)).toThrow(LlmTargetError);
    }
  });

  it("forwards only the headers a provider needs", () => {
    expect(
      forwardableRequestHeaders({
        "content-type": "application/json",
        authorization: "Bearer sk-1",
        "x-api-key": "sk-2",
        "anthropic-version": "2023-06-01",
        cookie: "scribedog_session=secret",
        host: "notes.example.com",
        origin: "https://notes.example.com",
        "x-scribedog-llm-url": "https://api.openai.com/v1",
        "accept-encoding": "gzip"
      })
    ).toEqual({
      "content-type": "application/json",
      authorization: "Bearer sk-1",
      "x-api-key": "sk-2",
      "anthropic-version": "2023-06-01"
    });
  });
});

describe("llm proxy route", () => {
  let context: TestContext;
  let cookie: string;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    context = await createTestContext();
    cookie = await context.login();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await context.cleanup();
  });

  const call = (headers: Record<string, string>, payload = '{"model":"gpt-4o"}') =>
    context.app.inject({
      method: "POST",
      url: "/api/llm/request",
      headers: { cookie, "content-type": "application/json", ...headers },
      payload
    });

  it("needs a session", async () => {
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/llm/request",
          headers: { "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions" },
          payload: "{}"
        })
      ).statusCode
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a target outside the allowlist without calling anything", async () => {
    const response = await call({ "x-scribedog-llm-url": "https://evil.example/v1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_endpoint" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("substitutes the stored key and passes the body through untouched", async () => {
    await context.app.inject({ method: "PUT", url: "/api/secrets/openai", headers: { cookie }, payload: { value: "sk-real-key" } });

    fetchMock.mockResolvedValue(
      new Response('{"choices":[]}', { status: 200, headers: { "content-type": "application/json", "set-cookie": "x=1" } })
    );

    const response = await call({
      "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions",
      authorization: `Bearer ${secretRef("openai")}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ choices: [] });
    // Nothing of ours leaks back to the browser beyond the content type.
    expect(response.headers["set-cookie"]).toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(url.toString()).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-real-key");
    expect((init.headers as Record<string, string>).cookie).toBeUndefined();
    expect(Buffer.from(init.body as Buffer).toString()).toBe('{"model":"gpt-4o"}');
  });

  it("streams the answer back as it arrives", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"));
        controller.enqueue(new TextEncoder().encode("data: two\n\n"));
        controller.close();
      }
    });

    fetchMock.mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));

    const response = await call({ "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions" });

    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.body).toBe("data: one\n\ndata: two\n\n");
  });

  it("hands the provider's own error through", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"invalid api key"}}', { status: 401, headers: { "content-type": "application/json" } })
    );

    const response = await call({ "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { message: "invalid api key" } });
  });

  it("answers 502 when the provider cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    const response = await call({ "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: "upstream_unreachable" });
  });

  it("asks for a new sign-in when the key cookie is missing", async () => {
    const sessionOnly = cookie.split("; ").find((entry) => !entry.startsWith(`${KEY_COOKIE_NAME}=`)) ?? "";

    const response = await context.app.inject({
      method: "POST",
      url: "/api/llm/request",
      headers: {
        cookie: sessionOnly,
        "content-type": "application/json",
        "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions",
        authorization: `Bearer ${secretRef("openai")}`
      },
      payload: "{}"
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "secrets_locked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves an unknown placeholder in place rather than inventing a key", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

    await call({
      "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions",
      authorization: `Bearer ${secretRef("mistral")}`
    });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${secretRef("mistral")}`);
  });

  // Over a real socket Node closes the request stream, "close" event included,
  // as soon as the body has been read. A proxy that takes the request's
  // "close" for the browser hanging up aborts its upstream call before it
  // starts and never answers; inject() does not reproduce that timing, so
  // this one listens.
  it("answers a POST over a real connection", async () => {
    fetchMock.mockResolvedValue(new Response('{"choices":[]}', { status: 200, headers: { "content-type": "application/json" } }));

    const address = await context.app.listen({ port: 0, host: "127.0.0.1" });
    const response = await postOverSocket(`${address}/api/llm/request`, {
      cookie,
      "content-type": "application/json",
      "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions"
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('{"choices":[]}');
  });

  it("aborts the provider call when the browser hangs up mid-stream", async () => {
    // An upstream that never finishes: only the client going away can end it.
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"));
      }
    });

    fetchMock.mockResolvedValue(new Response(upstream, { status: 200, headers: { "content-type": "text/event-stream" } }));

    const address = await context.app.listen({ port: 0, host: "127.0.0.1" });
    const { hangUp, firstChunk } = openStreamOverSocket(`${address}/api/llm/request`, {
      cookie,
      "content-type": "application/json",
      "x-scribedog-llm-url": "https://api.openai.com/v1/chat/completions"
    });

    expect(await firstChunk).toBe("data: one\n\n");

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(init.signal?.aborted).toBe(false);
    hangUp();
    await vi.waitFor(() => expect(init.signal?.aborted).toBe(true));
  });

  it("forwards a GET (the model list) without a body", async () => {
    fetchMock.mockResolvedValue(new Response('{"data":[]}', { status: 200, headers: { "content-type": "application/json" } }));

    const response = await context.app.inject({
      method: "GET",
      url: "/api/llm/request",
      headers: { cookie, "x-scribedog-llm-url": "https://api.openai.com/v1/models" }
    });

    expect(response.statusCode).toBe(200);

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});

/** A POST with node:http, which the fetch stub above does not touch. */
function postOverSocket(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const payload = '{"model":"gpt-4o"}';

  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers: { ...headers, "content-length": String(payload.length) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });

    request.on("error", reject);
    request.end(payload);
  });
}

/** Opens a streaming POST and hands back the first chunk plus a way to drop the connection. */
function openStreamOverSocket(url: string, headers: Record<string, string>): { firstChunk: Promise<string>; hangUp: () => void } {
  const payload = '{"model":"gpt-4o","stream":true}';
  const request = httpRequest(url, { method: "POST", headers: { ...headers, "content-length": String(payload.length) } });
  const firstChunk = new Promise<string>((resolve, reject) => {
    request.on("response", (response) => {
      response.once("data", (chunk: Buffer) => resolve(chunk.toString()));
    });
    request.on("error", reject);
  });

  request.end(payload);

  return { firstChunk, hangUp: () => request.destroy() };
}
