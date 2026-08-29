/**
 * MCP 어댑터 — 훅·CLI 와 **같은 코어**를 도구로 노출한다(스펙 §1의 두 번째 어댑터).
 *
 * 이 파일은 도구 정의와 디스패치만 담당한다. stdio JSON-RPC 배선은 `mcp/server.js` 가
 * 얇게 감싼다 — 전송을 분리해야 순수 함수로 단위 테스트할 수 있다.
 *
 * 세 가지 계약:
 *
 *  (1) **CLI 를 셸아웃하지 않는다.** gate/wave/ledger/report/ship/doctor/state 모듈을 직접
 *      부른다. 어댑터가 CLI 를 실행하면 프로세스 경계가 하나 더 생겨 훅·CLI·MCP 세 경로의
 *      판정이 갈릴 수 있다. 판정 로직은 코어 한 곳이라는 §1 의 전제를 지킨다.
 *      단, cli.ts 의 `run()` 스위치가 콘솔 출력과 뒤엉켜 있어 재사용할 수 없는 자리
 *      (gate submit 의 리뷰 패킷 기록, node bump 의 STALE 마킹 루프)는 여기서 다시 조립한다 —
 *      두 곳 모두 코어 계약의 일부라 빠뜨리면 §4-3(심사 패킷)·§3-2(STALE 전파)가 뚫린다.
 *
 *  (2) **callTool 은 절대 throw 하지 않는다.** MCP 클라이언트에게 예외는 프로토콜 오류로
 *      보이고, 모델은 그 안의 안내 문구를 보지 못한 채 같은 실수를 반복한다. 모든 실패는
 *      `{ok:false, content:<행동 가능한 한국어 안내>}` 로 되돌려 모델이 다음 수를 알게 한다.
 *
 *  (3) **게이트 승인은 MCP 로 열 수 없다 (§4-3 안전 속성).**
 *      `harness gate approve` 는 의도적으로 permission allowlist 에서 제외되어, 실행할 때마다
 *      권한 다이얼로그가 뜨고 게이트를 여는 최종 클릭은 항상 사람이 한다. MCP 도구로 승인을
 *      대행하면 그 장치를 통째로 우회한다 — LLM 단독으로 설계·출하 게이트를 열 수 있게 된다.
 *
 *      **선택: 도구 목록에 남기되 무조건 거절한다** (숨기지 않는다).
 *      목록에서 빼면 승인 경로를 찾는 모델이 무엇을 해야 하는지 알 수 없어 임의의 우회
 *      (state.json 직접 수정 등)를 시도할 수 있다. 노출해 두고 "왜 여기서는 안 되고 어디로
 *      가야 하는지"를 거절 메시지로 가르치는 편이 실제로 더 안전하다. 거절은 권한 설정과
 *      무관한 **코드 수준 불변식**이다 — 사용자가 MCP 도구를 통째로 allowlist 에 넣어도
 *      approveGate 는 이 경로에서 결코 호출되지 않는다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isInitialized, hasHarness, readState } from './state';
import { appendEvent } from './events';
import { submitGate } from './gate';
import { createWave, activateWave, logTurn, completeWave, listWaves, markStale, UNSPECIFIED } from './wave';
import { pick } from './i18n';
import { langFor } from './tr';
import { getNode, mergeNode, reviseNode } from './ledger';
import { loadRegistry } from './registry';
import { renderRtm, buildHub, buildReviewPacket, traceNode } from './report';
import { shipVerdict } from './ship';
import { runDoctor } from './doctor';
import { packetsDir, humanCmd } from './paths';
import { PHASES, EVIDENCE_GRADES, LEDGER_STATUSES, isPhase, isEvidenceGrade } from './types';
import type { EvidenceGrade, LedgerNode } from './types';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  ok: boolean;
  content: string;
}


const NO_ARGS = { type: 'object' as const, properties: {} };

const phaseProp = {
  type: 'string',
  enum: [...PHASES],
  description: 'Phase id (P0–P12)',
};

const strArrProp = (description: string) => ({
  type: 'array', items: { type: 'string' }, description,
});

/**
 * 도구 목록. 이름은 전부 `harness_` 접두 snake_case 로 고정한다 — CLI 명령 경로
 * (`harness gate submit`)와 1:1 로 읽히게 해서 둘 중 무엇을 봐도 같은 표면임을 알게 한다.
 *
 * **i18n 예외: 설명문은 영어 고정이다.** 여기 문자열은 사람에게 보이는 UI 가 아니라
 * 모델이 읽고 도구 선택·인자 구성에 쓰는 **프로토콜 표면**이다. 로케일마다 스키마가
 * 달라지면 같은 버그가 언어별로 다르게 재현되고, 그때 무엇이 정본인지 비교할 근거가 사라진다.
 * 사람이 읽는 결과 문자열은 코어가 내므로 그쪽은 `lang` 을 그대로 따른다.
 */
export function toolDefinitions(): McpToolDef[] {
  return [
    {
      name: 'harness_status',
      description: 'Read harness state (current phase, active wave, gates, backtrack) as JSON.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_gate_submit',
      description:
        'Submit artifacts to a phase gate for review. Pins the artifact hash and writes a review '
        + 'packet under .harness/packets/. Approval is separate and only a human can do it. '
        + 'The submission is refused when the artifacts are empty or placeholders only, when the '
        + 'same content already opened another gate, or when the registry lists those paths under a '
        + 'different phase.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: phaseProp,
          paths: strArrProp('Artifact paths to review, relative to the project root. At least one is required.'),
          evidence: {
            type: 'string',
            enum: [...EVIDENCE_GRADES],
            description: 'Evidence grade. Defaults to claimed. The ship track (P10–P12) passes on measured only.',
          },
        },
        required: ['phase', 'paths'],
      },
    },
    {
      name: 'harness_gate_approve',
      description:
        '[UNAVAILABLE] Gate approval cannot be done over MCP. Approval only happens in the terminal '
        + 'via `harness gate approve <P>`, which raises a permission dialog on every run so the final '
        + 'click is always a human (spec §4-3). This tool only points you to that path.',
      inputSchema: {
        type: 'object',
        properties: { phase: phaseProp },
      },
    },
    {
      name: 'harness_gate_status',
      description: 'Read the per-phase gate records (status, hash, evidence grade, approval time) as JSON.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_wave_create',
      description:
        'Create a wave instruction sheet (pending). design_refs must already exist in the design '
        + 'ledger — ghost references are rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          milestone: { type: 'string', description: 'Milestone this wave belongs to (e.g. M2-checkout)' },
          goal: { type: 'string', description: 'One line stating what this wave finishes' },
          design_refs: strArrProp('Design-ledger node ids this wave implements (e.g. F-12, API-23)'),
          acceptance: strArrProp('Acceptance criteria'),
        },
        // [API-11] 도메인이 goal 없는 웨이브를 거부한다 — 스키마도 그렇게 말해야 한다.
        required: ['goal'],
      },
    },
    {
      name: 'harness_wave_activate',
      description: 'Activate a wave. Only one can be active at a time.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Wave id (e.g. wave-012)' } },
        required: ['id'],
      },
    },
    {
      name: 'harness_wave_update',
      description: 'Append one line to the active wave\'s turn log (what you did + what is next). Empty text is refused.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Turn log entry' } },
        required: ['text'],
      },
    },
    {
      name: 'harness_wave_complete',
      description: 'Complete the active wave. A wave referencing UX nodes is refused without visual evidence.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_wave_list',
      description: 'Read every wave\'s frontmatter (id, milestone, design refs, status, acceptance) as JSON.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_node_upsert',
      description: 'Create or update a design-ledger node. The version is preserved; revise with harness_node_bump.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Node id (C-x/D-x/M-x/F-x/UX-x/API-x/SCH-x/DS-*/ADR-x)' },
          title: { type: 'string', description: 'Node title' },
          parent: { type: 'string', description: 'Parent node id' },
          doc_anchor: { type: 'string', description: 'Where the canonical text lives (file#heading)' },
          status: {
            type: 'string',
            enum: [...LEDGER_STATUSES],
            description: 'Node status. If omitted, the existing value is kept (draft when there is none).',
          },
        },
        required: ['id', 'title'],
      },
    },
    {
      name: 'harness_node_bump',
      description:
        'Revise a design node (version++, stale) and propagate STALE to every wave that cites it, '
        + 'including completed ones, so they land in the cross-check queue.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Id of the node to revise' } },
        required: ['id'],
      },
    },
    {
      name: 'harness_trace',
      description:
        'Design→wave→code trace (§3-2). Joins the node with the waves that cite it in design_refs '
        + 'and the registered documents that link it via linkedNodes.',
      inputSchema: {
        type: 'object',
        properties: { node_id: { type: 'string', description: 'Design-ledger node id to trace' } },
        required: ['node_id'],
      },
    },
    {
      name: 'harness_report_rtm',
      description: 'Render the requirements traceability matrix (RTM) as markdown.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_report_hub',
      description: 'Render the artifact hub (document registry + artifact URL index) as markdown.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_ship_verdict',
      description:
        'Final P12 go/no-go verdict. Never passes without measured evidence. On NO-GO it returns the '
        + 'list of reasons.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_doctor',
      description: 'Diagnose the state store. With repair, attempt recovery by replaying the event journal.',
      inputSchema: {
        type: 'object',
        properties: {
          repair: { type: 'boolean', description: 'Rebuild state.json by replaying the journal' },
          force: { type: 'boolean', description: 'Repair even when the journal cannot be trusted' },
        },
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 인자 해석 — MCP 클라이언트가 무엇을 보내든 throw 하지 않는다
// ─────────────────────────────────────────────────────────────────────────────

/** 배열·원시값·null 은 전부 빈 객체로 본다 — 스키마를 어긴 호출이 예외가 되면 안 된다. */
function asObject(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

const str = (o: Record<string, unknown>, k: string): string | undefined =>
  typeof o[k] === 'string' ? (o[k] as string) : undefined;

/** 배열이 아니면 빈 배열. 배열 안의 비문자열은 버린다(숫자 경로를 경로로 오인하지 않는다). */
const strArr = (o: Record<string, unknown>, k: string): string[] =>
  Array.isArray(o[k]) ? (o[k] as unknown[]).filter((v): v is string => typeof v === 'string') : [];

const bool = (o: Record<string, unknown>, k: string): boolean => o[k] === true;

const ok = (content: string): McpToolResult => ({ ok: true, content });
const fail = (content: string): McpToolResult => ({ ok: false, content });
const json = (v: unknown): McpToolResult => ok(JSON.stringify(v, null, 2));

/** 상태를 바꾸지 않는 도구 — .harness/ 가 없어도 진단할 수 있어야 하는 doctor 만 예외다. */
const NEEDS_INIT_EXEMPT = new Set(['harness_doctor', 'harness_gate_approve']);

const INIT_GUIDANCE =
  'No .harness/ here — this project is not managed by the harness yet. '
  + 'Run `harness init` in the terminal first.';

/**
 * [OPS-99] `.harness/` 는 있는데 `state.json` 만 없는 상태 — **미초기화가 아니라 열화**다.
 * 이 둘을 한 문장으로 뭉뚱그리면 「관리되지 않는 프로젝트다 → init 하라」는 거짓 안내가
 * 나가고, `init` 은 디렉토리가 이미 있다며 거부해 사람이 빠져나갈 길이 없다. CLI 는
 * OPS-94 로 이 함정을 닫았는데 이 표면에는 그대로 남아 있었다.
 */
const REPAIR_GUIDANCE =
  '.harness/ is here but state.json is missing — the state store is derived, so the event '
  + 'journal can rebuild it. Call harness_doctor with repair: true (or run `harness doctor --repair` '
  + 'in the terminal). Do not run `harness init`: it refuses while .harness/ exists.';

/** §4-3 안전 속성. 어떤 인자·어떤 상태에서도 승인은 일어나지 않는다. */
function refuseApprove(o: Record<string, unknown>): McpToolResult {
  const phase = str(o, 'phase');
  const target = isPhase(phase) ? phase : '<P0..P12>';
  return fail(
    `Gate approval cannot be done over MCP — run \`${humanCmd(`gate approve ${target}`)}\` in the terminal.\n`
    + 'That command is deliberately excluded from the permission allowlist, so a permission dialog '
    + 'appears on every run and the final click that opens a gate is always a human (spec §4-3). Approving on '
    + "your behalf through an MCP tool would bypass that, so this path refuses.\n"
    + 'You can still submit: use `harness_gate_submit` to build a review packet and hand it to a human.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 디스패치
// ─────────────────────────────────────────────────────────────────────────────

export function callTool(root: string, name: string, args: unknown): McpToolResult {
  const o = asObject(args);

  // 승인 거절은 init 검사·예외 처리보다 앞선다 — 어떤 경로로도 우회되지 않게.
  if (name === 'harness_gate_approve') return refuseApprove(o);

  const def = toolDefinitions().find(d => d.name === name);
  if (!def) {
    return fail(
      `Unknown tool: ${name} — available tools: `
      + toolDefinitions().map(d => d.name).join(', '),
    );
  }

  /**
   * [API-98] 스키마에 없는 입력 키는 **거부**한다 — CLI 의 미지 플래그(UTIL-D)와 같은 부류다.
   * 조용히 무시하면 `titel` 같은 오타 하나가 「요청한 것과 다른 레코드」를 원장에 남기고,
   * 부른 쪽은 성공(ok=true)만 보므로 영영 모른다. 판정 근거는 도구가 스스로 선언한
   * `inputSchema.properties` 라 새 도구가 생겨도 목록이 갈리지 않는다.
   */
  const allowed = Object.keys(def.inputSchema.properties);
  const unknownKeys = Object.keys(o).filter(k => !allowed.includes(k));
  if (unknownKeys.length > 0) {
    return fail(
      `Unknown input for ${name}: ${unknownKeys.join(', ')} — this tool takes `
      + `${allowed.length > 0 ? allowed.join(', ') : 'no arguments'}. `
      + 'An unknown key is never applied, so it would have recorded something other than what was asked.',
    );
  }

  if (!hasHarness(root)) return fail(INIT_GUIDANCE);
  if (!NEEDS_INIT_EXEMPT.has(name) && !isInitialized(root)) return fail(REPAIR_GUIDANCE);

  try {
    return dispatch(root, name, o);
  } catch (e) {
    // 코어가 던지는 메시지는 이미 "무엇을 어떻게 고치라"는 안내다 — 그대로 전달한다.
    return fail(String(e instanceof Error ? e.message : e));
  }
}

function dispatch(root: string, name: string, o: Record<string, unknown>): McpToolResult {
  switch (name) {
    case 'harness_status':
      return json(readState(root));

    case 'harness_gate_status':
      return json(readState(root).gates);

    case 'harness_gate_submit': {
      const phase = str(o, 'phase');
      if (!isPhase(phase)) {
        return fail(`Invalid phase: ${String(o.phase)} (one of ${PHASES.join(', ')})`);
      }
      const evidence = (str(o, 'evidence') ?? 'claimed') as EvidenceGrade;
      if (!isEvidenceGrade(evidence)) {
        return fail(`Invalid evidence grade: ${evidence} (one of ${EVIDENCE_GRADES.join(', ')})`);
      }
      const r = submitGate(root, phase, { paths: strArr(o, 'paths'), evidence });
      // 제출은 곧 심사 요청이다 — 리뷰 패킷을 함께 남긴다(§4-3, cli.ts 와 같은 계약).
      // 패킷 실패가 제출을 되돌리지는 않는다(게이트 레코드는 이미 저널에 있다).
      let packet = '';
      try {
        fs.mkdirSync(packetsDir(root), { recursive: true });
        packet = path.join(packetsDir(root), `${phase}.md`);
        fs.writeFileSync(packet, buildReviewPacket(root, phase));
      } catch (e) {
        return ok(
          `${phase} submitted — hash ${r.artifactHash?.slice(0, 12)} · evidence ${r.evidence}\n`
          + `Warning: review packet generation failed (the submission still stands) — ${String(e)}`,
        );
      }
      return ok(
        `${phase} submitted — hash ${r.artifactHash?.slice(0, 12)} · evidence ${r.evidence}\n`
        + `Review packet: ${path.relative(root, packet)}\n`
        + `Approve in the terminal with \`${humanCmd(`gate approve ${phase}`)}\` — the final click is a human.`,
      );
    }

    case 'harness_wave_create': {
      // [ENG-D] 유령 참조 검증은 도메인(createWave)이 한다 — 어댑터마다 복제하지 않는다.
      const refs = strArr(o, 'design_refs');
      const meta = createWave(root, {
        milestone: str(o, 'milestone') ?? pick(UNSPECIFIED, langFor(root)),
        goal: str(o, 'goal') ?? pick(UNSPECIFIED, langFor(root)),
        design_refs: refs,
        acceptance: strArr(o, 'acceptance'),
      });
      return ok(meta.id);
    }

    case 'harness_wave_activate': {
      const id = str(o, 'id');
      if (!id) return fail('A wave id is required — list them with `harness_wave_list`');
      activateWave(root, id);
      return ok(`Active: ${id}`);
    }

    case 'harness_wave_update': {
      const text = (str(o, 'text') ?? '').trim();
      if (!text) return fail('The turn log entry is empty — write what you did and what is next');
      logTurn(root, text);
      return ok('Turn log recorded');
    }

    case 'harness_wave_complete':
      completeWave(root);
      return ok('Wave completed');

    case 'harness_wave_list':
      return json(listWaves(root));

    case 'harness_node_upsert': {
      const id = str(o, 'id');
      const title = str(o, 'title');
      if (!id || !title) return fail('Both id and title are required');
      const status = str(o, 'status');
      if (status !== undefined && !LEDGER_STATUSES.includes(status as LedgerNode['status'])) {
        return fail(`Invalid status: ${status} (one of ${LEDGER_STATUSES.join(', ')})`);
      }
      // 병합 의미론은 도메인 한 벌이다(`mergeNode`) — 표면은 사용자가 준 것만 넘긴다.
      mergeNode(root, {
        id, title,
        parent: str(o, 'parent'),
        doc_anchor: str(o, 'doc_anchor'),
        status: status as LedgerNode['status'] | undefined,
      });
      return ok(id);
    }

    case 'harness_node_bump': {
      const id = str(o, 'id');
      if (!id) return fail('A node id to revise is required');
      // 개정의 규칙(저널 + STALE 전파)은 도메인 한 벌이다 — 표면은 보고만 한다.
      const { node, marked, failed, unverifiable } = reviseNode(root, id);
      const head = `${node.id} v${node.version} — ${pick({
        en: `STALE waves: ${marked.join(', ') || 'none'}`,
        ko: `STALE 웨이브: ${marked.join(', ') || '없음'}`,
      }, langFor(root))}`;
      // 판정 못 한 웨이브와 마킹 못 한 웨이브는 둘 다 STALE 전파가 뚫린 것이다 — 성공으로 끝내지 않는다.
      const incomplete = [...unverifiable, ...failed];
      if (incomplete.length > 0) {
        return fail(`${head}\nIncomplete STALE propagation — unverifiable/failed waves: ${incomplete.join(', ')} — check manually`);
      }
      return ok(head);
    }

    case 'harness_trace': {
      const id = str(o, 'node_id');
      if (!id) return fail('A node id to trace is required (node_id)');
      // 조인 규칙은 report.traceNode 한 벌이다 — CLI `harness trace` 와 같은 결과를 보장한다.
      const t = traceNode(root, id);
      if (!t) {
        return fail(
          `Node ${id} is not in the design ledger — register it with \`harness_node_upsert\`, `
          // [UX-A4] rtm 은 F- 노드만 싣는다 — UX-·FEAT- 를 찾는 사람에게는 답이 없는 곳이다.
          + 'or list known nodes with `harness node list`',
        );
      }
      return json(t);
    }

    case 'harness_report_rtm':
      return ok(renderRtm(root));

    case 'harness_report_hub':
      return ok(buildHub(root));

    case 'harness_ship_verdict': {
      const v = shipVerdict(root);
      const body = (v.ok ? 'GO' : 'NO-GO')
        + (v.reasons.length > 0 ? `\n${v.reasons.map(r => `  - ${r}`).join('\n')}` : '');
      // NO-GO 는 도구 실패가 아니라 판정 결과다 — 다만 모델이 "통과했다"로 읽지 않도록
      // ok:false 로 돌려 CLI 의 exit code 계약(verdict NO-GO = 1)과 맞춘다.
      return { ok: v.ok, content: body };
    }

    case 'harness_doctor': {
      const r = runDoctor(root, { repair: bool(o, 'repair'), force: bool(o, 'force') });
      return { ok: r.ok || r.repaired, content: JSON.stringify(r, null, 2) };
    }

    /* c8 ignore next 2 */
    default:
      return fail(`Unknown tool: ${name}`);
  }
}
