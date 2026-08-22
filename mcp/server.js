#!/usr/bin/env node
// MCP stdio adapter — a thin shell that only does transport (JSON-RPC over stdin/stdout).
// Tool definitions, dispatch and every decision live in core/src/mcp.ts (→ core/dist/mcp.js).
//
// Protocol (modelcontextprotocol.io/specification/2025-06-18):
//  - Messages are **newline-delimited JSON**, not LSP-style Content-Length framing.
//    A message must not contain a raw newline — JSON.stringify escapes newlines inside strings
//    as \n, so this holds automatically.
//  - **Nothing** but valid MCP messages may be written to stdout. Logs go to stderr only.
//  - A failed tool run is reported as isError:true in the result, not as a protocol error —
//    that way the guidance text reaches the model verbatim (core's ok:false → isError:true).
//
// Zero dependencies. No MCP SDK — this plugin's only runtime dependency is yaml, and dist is
// committed so a bare clone works without a build (SHIP-11).

const SERVER_NAME = 'king-wjang-harness';
const SERVER_VERSION = '0.0.1';
const DEFAULT_PROTOCOL = '2025-06-18';

// Keep stdout clean: if the core ever calls console.log, that one line must not break the
// protocol, so the default console is pointed at stderr. Only send() below writes to stdout.
console.log = console.info = console.debug = (...a) => console.error(...a);

// core/dist is committed so a build-free clone install works. It can still be missing — and
// dying then makes Claude Code restart the server in a crash loop. So we stay alive, expose no
// tools, and explain how to build when called.
let core = null;
let loadError = null;
try {
  core = require('../core/dist/mcp.js');
} catch (e) {
  loadError = String((e && e.message) || e);
  console.error(
    `${SERVER_NAME}: no build in core/dist — run \`npm install\` (prepare) or \`npm run build\` to build it. (${loadError})`,
  );
}

/** Same root resolution as bin/harness — hook, CLI and MCP all look at the same .harness/. */
const projectRoot = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

const fs = require('node:fs');
const path = require('node:path');

/**
 * [COST-110] **Zero cost when not in use applies to this surface too.**
 *
 * The hook got that down to 3ms and 0 tokens for un-harnessed projects via the sh gate (PERF-95),
 * but MCP still exposed 16 tools (5.8KB of schema) every session in projects with no `.harness/` —
 * paying back through the side door what the hook had saved.
 *
 * The prescription is the one this file **already used** for a missing core bundle: stay alive,
 * expose no tools, explain when called. An un-harnessed project is treated the same way.
 */
const harnessPresent = () => {
  try { return fs.existsSync(path.join(projectRoot(), '.harness')); } catch { return false; }
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const textResult = (id, text, isError) =>
  result(id, { content: [{ type: 'text', text }], isError: Boolean(isError) });

function handle(msg) {
  const { id, method, params } = msg;
  // No id means it is a notification — we must not reply (notifications/initialized, etc.).
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    if (isNotification) return;
    // Echo back the version the client asked for. The surface this server implements
    // (initialize, tools/list, tools/call, ping) is identical across every published version.
    const requested = params && typeof params.protocolVersion === 'string'
      ? params.protocolVersion
      : DEFAULT_PROTOCOL;
    result(id, {
      protocolVersion: requested,
      // [COST-110] listChanged:true — if `.harness/` appears mid-session (`harness init`) the
      // tool list changes. With false, tools stay invisible for the rest of that session.
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }

  if (isNotification) return; // every other notification is ignored silently

  switch (method) {
    case 'ping':
      result(id, {});
      return;

    case 'tools/list':
      result(id, { tools: core && harnessPresent() ? core.toolDefinitions() : [] });
      return;

    case 'tools/call': {
      const name = params && typeof params.name === 'string' ? params.name : '';
      if (core && !harnessPresent()) {
        textResult(
          id,
          `${SERVER_NAME}: this project has no .harness/ — run \`harness init\` in the project root first. `
          + 'Until then the harness does nothing here, and these tools stay hidden on purpose.',
          true,
        );
        return;
      }
      if (!core) {
        textResult(
          id,
          `${SERVER_NAME} MCP server cannot load the core bundle (core/dist/mcp.js), so no tools are `
          + `available — build it with \`npm run build\` and restart the session. (${loadError})`,
          true,
        );
        return;
      }
      // An unknown tool also comes back as an isError result, not a protocol error (-32602) —
      // the core's "available tools: ..." guidance must reach the model to fix its next move.
      const r = core.callTool(projectRoot(), name, params ? params.arguments : undefined);
      textResult(id, r.content, !r.ok);
      return;
    }

    default:
      error(id, -32601, `Method not found: ${String(method)}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      error(null, -32700, 'Parse error');
      continue;
    }
    try {
      handle(msg);
    } catch (e) {
      // No handler failure may kill the server — dying turns into a crash loop.
      const detail = String((e && e.message) || e);
      console.error(`${SERVER_NAME}: handler failed — ${detail}`);
      if (msg && msg.id !== undefined && msg.id !== null) error(msg.id, -32603, detail);
    }
  }
});
process.stdin.on('end', () => process.exit(0));

/**
 * [COST-110] If `harness init` runs mid-session the tool list goes from none to all. Without
 * telling the client, the MCP surface stays empty for that whole session — cutting cost by
 * removing the feature. So we announce once, the moment it appears (then close the watcher).
 * A failing watcher must never take the server down (do-no-harm contract).
 */
if (core && !harnessPresent()) {
  try {
    const watcher = fs.watch(projectRoot(), (_event, name) => {
      if (name !== '.harness' || !harnessPresent()) return;
      try { watcher.close(); } catch { /* already closed — nothing to do */ }
      send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    });
    watcher.unref?.();
  } catch { /* cannot watch (permissions, platform) — tools appear next session */ }
}
