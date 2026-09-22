// A scripted OpenAI-compatible endpoint for the browser tests.
//
// The e2e stack (docker-compose.e2e.yml) puts this behind Caddy as
// https://llm.e2e.internal, and the ScribeCat server forwards the app's AI
// requests to it exactly as it would to api.openai.com. So what the tests
// exercise is the real chain: the agent loop in the browser, the LLM proxy,
// the streamed answer, the tool calls and the file tools against the vault.
// Only the model is fake.
//
// The scenario is chosen by a marker in the user's message ("e2e:create
// Name" and so on, see `scenarioFor`). A step that comes back with a tool
// result gets a short closing text, whatever the scenario. The planner and
// the reply classifier the app calls around a turn are recognised by their
// system prompts and answered so that they change nothing.
//
// No dependencies: it runs straight from the node image.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const MODEL = "mock-model";

/** Everything the tests may want to know afterwards, reset per test. */
const state = {
  requests: [],
  aborted: 0,
  // The mock also stands in for a model server on the user's own machine,
  // which the browser reaches directly (see localModel.spec.ts). Whether it
  // accepts the page's origin is what a real Ollama or Jan decides by
  // configuration, so the tests can switch it.
  cors: true
};

/** CORS headers for a browser calling the mock directly; none for the proxy (no Origin). */
function corsHeaders(request) {
  const origin = request.headers.origin;

  if (!origin || !state.cors) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": request.headers["access-control-request-headers"] ?? "content-type, authorization",
    vary: "Origin"
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...extraHeaders });
  response.end(body);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(message) {
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }

  return "";
}

function lastMessage(messages, role) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return messages[index];
    }
  }

  return null;
}

/**
 * What the last user message asks for. The marker sits anywhere in the text;
 * everything after it up to the end of the line is the argument.
 */
function scenarioFor(messages) {
  const user = lastMessage(messages, "user");
  const match = /e2e:([a-z-]+)(?:[ \t]+([^\n]*))?/.exec(textOf(user));

  return match ? { name: match[1], argument: (match[2] ?? "").trim() } : { name: "echo", argument: "" };
}

/** A note body long enough to notice in the editor, short enough to read in a test. */
const noteBody = (title) => `# ${title}\n\nWritten by the mock model.\n\n- first point\n- second point\n`;

/**
 * The answer for one agent step: either text, or one tool call. Tool calls
 * are OpenAI-shaped; the arguments are serialised the way a real model would
 * stream them.
 */
function agentStep(body) {
  const messages = body.messages ?? [];
  const lastRole = messages[messages.length - 1]?.role;

  const scenario = scenarioFor(messages);

  // "e2e:chain N": N tool calls in a row before the closing text, one per
  // step, the way a real multi-step run goes back and forth with the proxy.
  if (scenario.name === "chain") {
    const wanted = Number.parseInt(scenario.argument, 10) || 5;
    const userAt = messages.findLastIndex((message) => message.role === "user");
    const done = messages.slice(userAt + 1).filter((message) => message.role === "tool").length;

    return done < wanted
      ? { toolCall: { name: "list_files", arguments: {} } }
      : { text: `Done after ${done} tool calls.` };
  }

  // The result of our own tool call came back: close the turn.
  if (lastRole === "tool") {
    const result = textOf(messages[messages.length - 1]);
    const failed = /^error/i.test(result.trim());

    return { text: failed ? `The tool reported an error: ${result.slice(0, 120)}` : "Done." };
  }

  switch (scenario.name) {
    case "create": {
      const title = scenario.argument || "Mock note";

      return {
        toolCall: { name: "write_file", arguments: { path: `${title}.md`, content: noteBody(title) } }
      };
    }
    case "edit": {
      // "e2e:edit <path> | <old> | <new>"
      const [path, oldText, newText] = scenario.argument.split("|").map((part) => part.trim());

      return { toolCall: { name: "edit_file", arguments: { path, old_text: oldText, new_text: newText } } };
    }
    case "delete":
      return { toolCall: { name: "delete_file", arguments: { path: scenario.argument } } };
    case "read":
      return { toolCall: { name: "read_file", arguments: { path: scenario.argument } } };
    case "search":
      return { toolCall: { name: "search_files", arguments: { query: scenario.argument } } };
    case "list":
      return { toolCall: { name: "list_files", arguments: {} } };
    case "slow":
      // Forty tokens, one every 150 ms: six seconds of visible streaming,
      // long enough to press stop in the middle.
      return { text: Array.from({ length: 40 }, (_, index) => `token${index} `).join(""), delayMs: 150 };
    default:
      return { text: `Mock reply to: ${textOf(lastMessage(messages, "user")).slice(0, 80)}` };
  }
}

/** The planner and the classifier are side calls; both are answered so nothing happens. */
function sideCallAnswer(body) {
  const system = textOf(body.messages?.find((message) => message.role === "system"));

  if (system.startsWith("You break a request down into work steps")) {
    return '{"steps":[]}';
  }

  if (system.startsWith("You judge a single reply")) {
    return "no";
  }

  return null;
}

function completionChunk(id, delta, finishReason = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  };
}

/** Splits text into word-sized tokens, whitespace attached to the word before it. */
function tokenize(text) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

async function streamAnswer(request, response, answer) {
  const id = `chatcmpl-mock-${Date.now().toString(36)}`;
  let closed = false;

  // The response's "close" before it is finished is the client going away.
  // (The request's "close" is no use: Node emits it as soon as the body has
  // been read, long before anyone hangs up.)
  response.on("close", () => {
    if (!response.writableFinished) {
      closed = true;
    }
  });

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...corsHeaders(request)
  });

  const send = (chunk) => {
    if (!closed) {
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  };

  send(completionChunk(id, { role: "assistant", content: "" }));

  if (answer.toolCall) {
    const callId = `call_${Date.now().toString(36)}`;
    const args = JSON.stringify(answer.toolCall.arguments);

    send(
      completionChunk(id, {
        tool_calls: [{ index: 0, id: callId, type: "function", function: { name: answer.toolCall.name, arguments: "" } }]
      })
    );

    // Arguments arrive in slices, as they do from a real model.
    for (let at = 0; at < args.length; at += 24) {
      send(completionChunk(id, { tool_calls: [{ index: 0, function: { arguments: args.slice(at, at + 24) } }] }));
    }

    send(completionChunk(id, {}, "tool_calls"));
  } else {
    for (const token of tokenize(answer.text)) {
      if (closed) {
        state.aborted += 1;
        return;
      }

      send(completionChunk(id, { content: token }));

      if (answer.delayMs) {
        await sleep(answer.delayMs);
      }
    }

    send(completionChunk(id, {}, "stop"));
  }

  if (!closed) {
    response.write("data: [DONE]\n\n");
    response.end();
  }
}

function completion(answer) {
  const message = answer.toolCall
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call_${Date.now().toString(36)}`,
            type: "function",
            function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.arguments) }
          }
        ]
      }
    : { role: "assistant", content: answer.text };

  return {
    id: `chatcmpl-mock-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, message, finish_reason: answer.toolCall ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");

  // Test-side introspection.
  if (url.pathname === "/__mock/state") {
    return sendJson(response, 200, state);
  }

  if (url.pathname === "/__mock/reset") {
    state.requests = [];
    state.aborted = 0;
    state.cors = true;
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === "/__mock/cors") {
    state.cors = url.searchParams.get("enabled") !== "false";
    return sendJson(response, 200, { cors: state.cors });
  }

  // The browser's preflight, when it calls the mock directly.
  if (request.method === "OPTIONS") {
    response.writeHead(state.cors ? 204 : 403, corsHeaders(request));
    return response.end();
  }

  if (url.pathname === "/v1/models") {
    return sendJson(response, 200, { object: "list", data: [{ id: MODEL, object: "model" }] }, corsHeaders(request));
  }

  if (url.pathname !== "/v1/chat/completions" || request.method !== "POST") {
    return sendJson(response, 404, { error: { message: `no such route: ${request.method} ${url.pathname}` } }, corsHeaders(request));
  }

  let body;

  try {
    body = JSON.parse(await readBody(request));
  } catch {
    return sendJson(response, 400, { error: { message: "invalid JSON" } });
  }

  state.requests.push({
    at: Date.now(),
    stream: body.stream === true,
    tools: (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name),
    authorization: request.headers.authorization ?? null,
    // Set when the browser called directly; the proxy sends no Origin.
    origin: request.headers.origin ?? null,
    lastRole: body.messages?.[body.messages.length - 1]?.role ?? null,
    scenario: scenarioFor(body.messages ?? []).name
  });

  const side = sideCallAnswer(body);
  const answer = side !== null ? { text: side } : agentStep(body);

  if (body.stream === true) {
    return streamAnswer(request, response, answer);
  }

  return sendJson(response, 200, completion(answer), corsHeaders(request));
});

server.listen(PORT, () => {
  console.log(`mock llm listening on ${PORT}`);
});
