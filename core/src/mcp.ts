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
import { isInitialized, readState } from './state';
import { appendEvent } from './events';
import { submitGate } from './gate';
import { createWave, activateWave, logTurn, completeWave, listWaves, markStale } from './wave';
import { getNode, upsertNode, bumpNode } from './ledger';
import { loadRegistry } from './registry';
import { renderRtm, buildHub, buildReviewPacket } from './report';
import { shipVerdict } from './ship';
import { runDoctor } from './doctor';
import { packetsDir } from './paths';
import { PHASES, EVIDENCE_GRADES, isPhase, isEvidenceGrade } from './types';
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

const LEDGER_STATUSES: readonly LedgerNode['status'][] = ['draft', 'approved', 'stale'];

const NO_ARGS = { type: 'object' as const, properties: {} };

const phaseProp = {
  type: 'string',
  enum: [...PHASES],
  description: '페이즈 ID (P0~P12)',
};

const strArrProp = (description: string) => ({
  type: 'array', items: { type: 'string' }, description,
});

/**
 * 도구 목록. 이름은 전부 `harness_` 접두 snake_case 로 고정한다 — CLI 명령 경로
 * (`harness gate submit`)와 1:1 로 읽히게 해서 둘 중 무엇을 봐도 같은 표면임을 알게 한다.
 */
export function toolDefinitions(): McpToolDef[] {
  return [
    {
      name: 'harness_status',
      description: '하네스 상태(현재 페이즈·활성 웨이브·게이트·역행)를 JSON 으로 조회한다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_gate_submit',
      description:
        '페이즈 게이트에 산출물을 제출한다(심사 요청). 산출물 해시를 고정하고 리뷰 패킷을 '
        + '.harness/packets/ 에 남긴다. 승인은 별도이며 사람만 할 수 있다.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: phaseProp,
          paths: strArrProp('심사받을 산출물 경로(루트 기준 상대경로). 최소 1개 필요.'),
          evidence: {
            type: 'string',
            enum: [...EVIDENCE_GRADES],
            description: '근거 등급. 기본 claimed. 출하 트랙(P10~P12)은 measured 만 통과한다.',
          },
        },
        required: ['phase', 'paths'],
      },
    },
    {
      name: 'harness_gate_approve',
      description:
        '[사용 불가] 게이트 승인은 MCP 로 할 수 없다. 승인은 터미널에서 '
        + '`harness gate approve <P>` 로만 가능하며, 실행마다 권한 다이얼로그가 떠서 '
        + '최종 클릭은 항상 사람이 한다(스펙 §4-3). 이 도구는 그 경로를 안내만 한다.',
      inputSchema: {
        type: 'object',
        properties: { phase: phaseProp },
      },
    },
    {
      name: 'harness_gate_status',
      description: '페이즈별 게이트 레코드(상태·해시·근거 등급·승인 시각)를 JSON 으로 조회한다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_wave_create',
      description:
        '웨이브 지시서를 만든다(pending). design_refs 는 설계 원장에 이미 등록된 노드여야 한다 — '
        + '유령 참조는 거부된다.',
      inputSchema: {
        type: 'object',
        properties: {
          milestone: { type: 'string', description: '소속 마일스톤 (예: M2-결제)' },
          goal: { type: 'string', description: '이 웨이브의 목표 한 줄' },
          design_refs: strArrProp('구현 대상 설계 원장 노드 ID (예: F-12, API-23)'),
          acceptance: strArrProp('완료 기준'),
        },
      },
    },
    {
      name: 'harness_wave_activate',
      description: '웨이브를 활성화한다. 동시에 하나만 활성 가능하다.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '웨이브 ID (예: wave-012)' } },
        required: ['id'],
      },
    },
    {
      name: 'harness_wave_update',
      description: '활성 웨이브 지시서의 턴 로그에 한 줄 기록한다(한 일 + 다음 할 일). 빈 내용은 거부된다.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: '턴 로그 내용' } },
        required: ['text'],
      },
    },
    {
      name: 'harness_wave_complete',
      description: '활성 웨이브를 완료 처리한다. UX 노드를 참조하는 웨이브는 시각 증적이 없으면 거부된다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_wave_list',
      description: '모든 웨이브의 frontmatter(ID·마일스톤·설계 참조·상태·완료 기준)를 JSON 으로 조회한다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_node_upsert',
      description: '설계 원장 노드를 등록·수정한다. version 은 보존되며 개정은 harness_node_bump 로 한다.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '노드 ID (C-x/D-x/M-x/F-x/UX-x/API-x/SCH-x/DS-*/ADR-x)' },
          title: { type: 'string', description: '노드 제목' },
          parent: { type: 'string', description: '상위 노드 ID' },
          doc_anchor: { type: 'string', description: '정본 위치 (파일#헤딩)' },
          status: {
            type: 'string',
            enum: [...LEDGER_STATUSES],
            description: '노드 상태. 미지정이면 기존 값(없으면 draft) 유지.',
          },
        },
        required: ['id', 'title'],
      },
    },
    {
      name: 'harness_node_bump',
      description:
        '설계 노드를 개정한다(version++ · stale). 이 노드를 참조하는 웨이브를 완료분까지 '
        + 'STALE 로 전파해 교차 검증 큐에 올린다.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '개정할 노드 ID' } },
        required: ['id'],
      },
    },
    {
      name: 'harness_trace',
      description:
        '설계→웨이브→코드 추적 조회(§3-2). 노드와, 그 노드를 design_refs 로 참조하는 웨이브들, '
        + '그 노드를 linkedNodes 로 링크한 등록 문서들을 조인해 돌려준다.',
      inputSchema: {
        type: 'object',
        properties: { node_id: { type: 'string', description: '추적할 설계 원장 노드 ID' } },
        required: ['node_id'],
      },
    },
    {
      name: 'harness_report_rtm',
      description: '요구사항 추적 매트릭스(RTM)를 마크다운으로 렌더링한다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_report_hub',
      description: '산출물 허브(문서 레지스트리 + 아티팩트 URL 색인)를 마크다운으로 렌더링한다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_ship_verdict',
      description:
        'P12 최종 go/no-go 판정. measured 근거 없이는 통과하지 않는다. NO-GO 면 사유 목록을 함께 돌려준다.',
      inputSchema: NO_ARGS,
    },
    {
      name: 'harness_doctor',
      description: '상태 저장소를 진단한다. repair 로 이벤트 저널 재생 기반 복구를 시도한다.',
      inputSchema: {
        type: 'object',
        properties: {
          repair: { type: 'boolean', description: '저널 재생으로 state.json 복구 시도' },
          force: { type: 'boolean', description: '저널을 신뢰할 수 없어도 복구 강행' },
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
  '.harness/ 가 없다 — 이 프로젝트는 아직 하네스로 관리되지 않는다. '
  + '터미널에서 `harness init` 을 먼저 실행하라.';

/** §4-3 안전 속성. 어떤 인자·어떤 상태에서도 승인은 일어나지 않는다. */
function refuseApprove(o: Record<string, unknown>): McpToolResult {
  const phase = str(o, 'phase');
  const target = isPhase(phase) ? phase : '<P0..P12>';
  return fail(
    `게이트 승인은 MCP 로 할 수 없다 — 터미널에서 \`harness gate approve ${target}\` 를 실행하라.\n`
    + '이 명령은 의도적으로 permission allowlist 에서 제외되어 있어 실행할 때마다 권한 '
    + '다이얼로그가 뜨고, 게이트를 여는 최종 클릭은 항상 사람이 한다(스펙 §4-3). '
    + 'MCP 도구로 승인을 대행하면 그 장치를 우회하게 되므로 이 경로는 승인하지 않는다.\n'
    + '제출까지는 `harness_gate_submit` 으로 할 수 있다 — 리뷰 패킷을 만들어 사람에게 넘겨라.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 디스패치
// ─────────────────────────────────────────────────────────────────────────────

export function callTool(root: string, name: string, args: unknown): McpToolResult {
  const o = asObject(args);

  // 승인 거절은 init 검사·예외 처리보다 앞선다 — 어떤 경로로도 우회되지 않게.
  if (name === 'harness_gate_approve') return refuseApprove(o);

  const known = toolDefinitions().some(d => d.name === name);
  if (!known) {
    return fail(
      `알 수 없는 도구: ${name} — 사용 가능한 도구: `
      + toolDefinitions().map(d => d.name).join(', '),
    );
  }

  if (!NEEDS_INIT_EXEMPT.has(name) && !isInitialized(root)) return fail(INIT_GUIDANCE);

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
        return fail(`유효하지 않은 페이즈: ${String(o.phase)} (${PHASES.join(', ')} 중 하나)`);
      }
      const evidence = (str(o, 'evidence') ?? 'claimed') as EvidenceGrade;
      if (!isEvidenceGrade(evidence)) {
        return fail(`유효하지 않은 근거 등급: ${evidence} (${EVIDENCE_GRADES.join(', ')} 중 하나)`);
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
          `${phase} 제출됨 — 해시 ${r.artifactHash?.slice(0, 12)} · 근거 ${r.evidence}\n`
          + `경고: 리뷰 패킷 생성 실패(제출은 유효) — ${String(e)}`,
        );
      }
      return ok(
        `${phase} 제출됨 — 해시 ${r.artifactHash?.slice(0, 12)} · 근거 ${r.evidence}\n`
        + `리뷰 패킷: ${path.relative(root, packet)}\n`
        + `승인은 터미널에서 \`harness gate approve ${phase}\` — 최종 클릭은 사람이 한다.`,
      );
    }

    case 'harness_wave_create': {
      // 원장에 없는 id 를 받으면 STALE 전파도 UX 게이트도 걸리지 않는 유령 참조가 된다.
      const refs = strArr(o, 'design_refs');
      const missing = refs.filter(id => !getNode(root, id));
      if (missing.length > 0) {
        return fail(
          `원장에 없는 설계 참조: ${missing.join(', ')} — `
          + '`harness_node_upsert` 로 먼저 등록하라',
        );
      }
      const meta = createWave(root, {
        milestone: str(o, 'milestone') ?? '(미지정)',
        goal: str(o, 'goal') ?? '(미지정)',
        design_refs: refs,
        acceptance: strArr(o, 'acceptance'),
      });
      return ok(meta.id);
    }

    case 'harness_wave_activate': {
      const id = str(o, 'id');
      if (!id) return fail('웨이브 ID 가 필요하다 — `harness_wave_list` 로 목록을 확인하라');
      activateWave(root, id);
      return ok(`활성: ${id}`);
    }

    case 'harness_wave_update': {
      const text = (str(o, 'text') ?? '').trim();
      if (!text) return fail('턴 로그 내용이 비어 있다 — 한 일과 다음 할 일을 적어라');
      logTurn(root, text);
      return ok('턴 로그 기록');
    }

    case 'harness_wave_complete':
      completeWave(root);
      return ok('웨이브 완료');

    case 'harness_wave_list':
      return json(listWaves(root));

    case 'harness_node_upsert': {
      const id = str(o, 'id');
      const title = str(o, 'title');
      if (!id || !title) return fail('id 와 title 이 모두 필요하다');
      const status = str(o, 'status');
      if (status !== undefined && !LEDGER_STATUSES.includes(status as LedgerNode['status'])) {
        return fail(`유효하지 않은 status: ${status} (${LEDGER_STATUSES.join(', ')} 중 하나)`);
      }
      const prev = getNode(root, id);
      upsertNode(root, {
        id, title,
        parent: str(o, 'parent') ?? prev?.parent,
        doc_anchor: str(o, 'doc_anchor') ?? prev?.doc_anchor,
        version: prev?.version ?? 1,                       // bump 이력 보존
        status: (status as LedgerNode['status']) ?? prev?.status ?? 'draft',
      });
      appendEvent(root, 'node-upserted', { id });
      return ok(id);
    }

    case 'harness_node_bump': {
      const id = str(o, 'id');
      if (!id) return fail('개정할 노드 ID 가 필요하다');
      const { node, affectedWaves, unverifiable } = bumpNode(root, id);
      // 저널 먼저 — 마킹 루프 도중에 죽어도 bump 사실은 남아야 한다(events.ts 순서 계약).
      appendEvent(root, 'node-bumped', {
        id: node.id, version: node.version, affected: affectedWaves, unverifiable,
      });
      const failed: string[] = [];
      for (const w of affectedWaves) {
        try { markStale(root, w); } catch { failed.push(w); }
      }
      const marked = affectedWaves.filter(w => !failed.includes(w));
      const head = `${node.id} v${node.version} — STALE 웨이브: ${marked.join(', ') || '없음'}`;
      // 판정 못 한 웨이브와 마킹 못 한 웨이브는 둘 다 STALE 전파가 뚫린 것이다 — 성공으로 끝내지 않는다.
      const incomplete = [...unverifiable, ...failed];
      if (incomplete.length > 0) {
        return fail(`${head}\nSTALE 전파 불완전 — 검증 불가/실패 웨이브: ${incomplete.join(', ')} — 수동 확인 필요`);
      }
      return ok(head);
    }

    case 'harness_trace': {
      const id = str(o, 'node_id');
      if (!id) return fail('추적할 노드 ID 가 필요하다 (node_id)');
      const node = getNode(root, id);
      if (!node) {
        return fail(
          `노드 ${id} 가 설계 원장에 없다 — \`harness_node_upsert\` 로 먼저 등록하거나 `
          + '`harness_report_rtm` 으로 등록된 노드를 확인하라',
        );
      }
      return json({
        node,
        waves: listWaves(root).filter(w => w.design_refs.includes(id)),
        docs: loadRegistry(root).docs.filter(d => d.linkedNodes.includes(id)),
      });
    }

    case 'harness_report_rtm':
      return ok(renderRtm(root));

    case 'harness_report_hub':
      return ok(buildHub(root));

    case 'harness_ship_verdict': {
      const v = shipVerdict(root);
      const body = (v.ok ? '출하 가능(GO)' : '출하 불가(NO-GO)')
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
      return fail(`알 수 없는 도구: ${name}`);
  }
}
