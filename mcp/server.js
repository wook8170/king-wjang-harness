#!/usr/bin/env node
// MCP stdio 어댑터 — 전송(JSON-RPC over stdin/stdout)만 담당하는 얇은 껍데기다.
// 도구 정의·디스패치·판정은 전부 core/src/mcp.ts(→ core/dist/mcp.js)에 있다.
//
// 프로토콜 (modelcontextprotocol.io/specification/2025-06-18):
//  - 메시지는 **개행 구분 JSON** 이다. LSP 식 Content-Length 헤더가 아니다.
//    한 메시지 안에 개행이 들어가면 안 된다 — JSON.stringify 가 문자열 내 개행을 \n 으로
//    이스케이프하므로 자동으로 지켜진다.
//  - stdout 에는 유효한 MCP 메시지 외에 **아무것도** 쓰면 안 된다. 로그는 stderr 로만.
//  - 도구 실행 실패는 프로토콜 오류가 아니라 결과의 isError:true 로 보고한다 —
//    그래야 안내 문구가 모델에게 그대로 전달된다(코어의 ok:false → isError:true).
//
// 의존성 0. MCP SDK 를 쓰지 않는다 — 이 플러그인의 런타임 의존은 yaml 하나뿐이고,
// dist 를 커밋해 순수 클론에서 빌드 없이 동작해야 한다(SHIP-11).

const SERVER_NAME = 'king-wjang-harness';
const SERVER_VERSION = '0.0.1';
const DEFAULT_PROTOCOL = '2025-06-18';

// stdout 오염 방지: 코어가 언젠가 console.log 를 쓰더라도 그 한 줄이 프로토콜을 깨뜨리지
// 않도록 표준 출력용 콘솔을 stderr 로 돌려놓는다. stdout 은 아래 send() 만 쓴다.
console.log = console.info = console.debug = (...a) => console.error(...a);

// core/dist 는 커밋된다(빌드 없는 클론 설치가 동작하도록). 그래도 dist 가 없을 수 있다 —
// 그때 죽으면 Claude Code 가 서버를 재기동하며 크래시 루프가 된다. 살아 있되 도구를
// 노출하지 않고, 호출되면 빌드 방법을 알려준다.
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

/** bin/harness 와 같은 루트 해석 규칙 — 훅·CLI·MCP 가 같은 .harness/ 를 본다. */
const projectRoot = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const textResult = (id, text, isError) =>
  result(id, { content: [{ type: 'text', text }], isError: Boolean(isError) });

function handle(msg) {
  const { id, method, params } = msg;
  // id 가 없으면 알림(notification) — 응답을 보내면 안 된다(notifications/initialized 등).
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    if (isNotification) return;
    // 클라이언트가 요청한 버전을 그대로 돌려준다. 이 서버가 구현하는 표면
    // (initialize·tools/list·tools/call·ping)은 모든 공개 버전에서 동일해 호환이 유지된다.
    const requested = params && typeof params.protocolVersion === 'string'
      ? params.protocolVersion
      : DEFAULT_PROTOCOL;
    result(id, {
      protocolVersion: requested,
      // listChanged:false — 도구 목록은 정적이라 변경 알림을 보내지 않는다.
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
    return;
  }

  if (isNotification) return; // 그 밖의 알림은 조용히 무시한다

  switch (method) {
    case 'ping':
      result(id, {});
      return;

    case 'tools/list':
      result(id, { tools: core ? core.toolDefinitions() : [] });
      return;

    case 'tools/call': {
      const name = params && typeof params.name === 'string' ? params.name : '';
      if (!core) {
        textResult(
          id,
          `${SERVER_NAME} MCP 서버가 코어 번들(core/dist/mcp.js)을 읽지 못해 도구를 쓸 수 없다 — `
          + `\`npm run build\` 로 빌드한 뒤 세션을 다시 시작하라. (${loadError})`,
          true,
        );
        return;
      }
      // 알 수 없는 도구도 프로토콜 오류(-32602)가 아니라 isError 결과로 돌려준다 —
      // 코어의 "사용 가능한 도구: ..." 안내가 모델에게 그대로 보여야 다음 수가 고쳐진다.
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
      // 어떤 핸들러 사고도 서버를 죽이지 않는다 — 죽으면 크래시 루프가 된다.
      const detail = String((e && e.message) || e);
      console.error(`${SERVER_NAME}: 처리 실패 — ${detail}`);
      if (msg && msg.id !== undefined && msg.id !== null) error(msg.id, -32603, detail);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
