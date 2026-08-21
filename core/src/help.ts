/**
 * 명령 레지스트리 + 사용법 (UX-24 · API-27).
 *
 * 출하 검증이 찾은 것: `--help`·`-h`·`help`·무인자가 **전부 exit 1 「알 수 없는 명령」** 이었다.
 * 13개 명령군·60여 하위명령을 가진 CLI 에 진입점이 0이라 소스를 읽어야 명령을 알 수 있었다.
 * 그리고 하위명령 안내가 **절반만** 있었다 — 8개 군은 `(a|b|c)` 를 알려주고 5개 군은
 * `알 수 없는 gate 하위 명령: undefined` 로 끝났다. 목록이 각 case 안에 손으로 박혀 있어서다.
 *
 * 그래서 **목록을 한 곳에 둔다.** 이 표가 유일한 정의이고 `--help`·군별 도움말·
 * 「알 수 없는 하위 명령」 안내가 전부 여기서 나온다 — 새 명령을 추가하면 세 곳이 함께 갱신된다.
 */
import { pick, type Lang, type Msg } from './i18n';

export interface SubCommand {
  name: string;
  /** 인자 서식. 언어 무관(플래그 이름은 번역하지 않는다). */
  args?: string;
  summary: Msg;
}

export interface CommandGroup {
  name: string;
  summary: Msg;
  /** 하위명령이 없는 단일 명령(init·status·doctor 등)은 비운다. */
  subs?: SubCommand[];
  args?: string;
}

const M = (en: string, ko: string): Msg => ({ en, ko });

export const COMMANDS: CommandGroup[] = [
  { name: 'init', summary: M('Create .harness/ and start the design track at P0.', '.harness/ 를 만들고 설계 트랙 P0 에서 시작한다.') },
  { name: 'status', summary: M('Print current phase, active wave, gates and backtrack as JSON.', '현재 페이즈·활성 웨이브·게이트·역행을 JSON 으로 출력한다.') },
  {
    name: 'doctor', args: '[--repair] [--force]',
    summary: M('Diagnose state vs journal; --repair rebuilds state from the event journal.', '상태와 저널을 대조해 진단한다. --repair 는 저널 재생으로 상태를 복구한다.'),
  },
  {
    name: 'phase', args: '<P0..P12>',
    summary: M('Move to a phase. Only an approved gate opens the next phase.', '페이즈를 옮긴다. 다음 페이즈는 게이트 승인으로만 열린다.'),
    subs: [{ name: 'set', args: '<P0..P12>', summary: M('Move to the phase (requires the previous gate approved).', '해당 페이즈로 이동한다(직전 게이트 승인 필요).') }],
  },
  {
    name: 'gate',
    summary: M('Phase gates — submit artifacts, then a human approves.', '페이즈 게이트 — 산출물을 제출하고 사람이 승인한다.'),
    subs: [
      { name: 'submit', args: '<P> --paths <a,b> [--evidence claimed|code|measured]', summary: M('Submit artifacts for review; pins their hash and writes a review packet.', '산출물을 심사에 올린다. 해시를 고정하고 리뷰 패킷을 남긴다.') },
      { name: 'approve', args: '<P>', summary: M('Approve a submitted gate. Humans only — never an agent.', '제출된 게이트를 승인한다. 사람만 한다 — 에이전트는 못 한다.') },
      { name: 'verify', args: '<P>', summary: M('Re-check that submitted artifacts still match their pinned hash.', '제출 당시 해시와 현재 산출물이 같은지 다시 확인한다.') },
      { name: 'sweep', summary: M('Invalidate gates whose artifacts changed after approval.', '승인 후 산출물이 바뀐 게이트를 무효화한다.') },
      { name: 'status', summary: M('Print all gate records as JSON.', '전 게이트 레코드를 JSON 으로 출력한다.') },
      { name: 'feedback', args: '<P> [--from <file>]', summary: M('Collect reviewer/canvas comments as revision grounds; without --from, print what was collected.', '리뷰·캔버스 코멘트를 개정 근거로 수집한다. --from 없이 부르면 수집된 것을 출력한다.') },
    ],
  },
  {
    name: 'wave',
    summary: M('Waves — the unit of build work, with a written instruction sheet.', '웨이브 — 지시서를 가진 구축 작업 단위.'),
    subs: [
      { name: 'create', args: '--goal <text> [--milestone <m>] [--refs <ids>] [--acceptance <list>]', summary: M('Create a wave instruction sheet (pending). Design refs must exist in the ledger.', '웨이브 지시서를 만든다(pending). 설계 참조는 원장에 있어야 한다.') },
      { name: 'activate', args: '<wave-id>', summary: M('Activate a wave. Only one can be active.', '웨이브를 활성화한다. 동시에 하나만 가능하다.') },
      { name: 'update', args: '<text>', summary: M('Append one turn-log line (what you did / what is next).', '턴 로그를 한 줄 남긴다(한 일 / 다음 할 일).') },
      { name: 'complete', summary: M('Complete the active wave. UX waves need visual evidence.', '활성 웨이브를 완료한다. UX 웨이브는 시각 증적이 필요하다.') },
      { name: 'list', summary: M('Print every wave frontmatter as JSON.', '전 웨이브 frontmatter 를 JSON 으로 출력한다.') },
    ],
  },
  {
    name: 'node',
    summary: M('Design ledger nodes — the things waves are allowed to implement.', '설계 원장 노드 — 웨이브가 구현할 수 있는 대상.'),
    subs: [
      { name: 'upsert', args: '--id <id> --title <t> [--parent <id>] [--anchor <file#h>] [--status <s>]', summary: M('Create or update a ledger node (version is preserved).', '원장 노드를 등록·수정한다(version 은 보존된다).') },
      { name: 'bump', args: '<id>', summary: M('Revise a node (version++, stale) and propagate STALE to waves that cite it.', '노드를 개정하고(version++·stale) 참조 웨이브에 STALE 을 전파한다.') },
    ],
  },
  {
    name: 'trace', args: '<node-id>',
    summary: M('Trace a design node to the waves and documents that reference it.', '설계 노드를 참조하는 웨이브·문서를 이어서 조회한다.'),
  },
  {
    name: 'report',
    summary: M('Rendered views over the ledger, registry and gates.', '원장·레지스트리·게이트를 렌더링한 뷰.'),
    subs: [
      { name: 'packet', args: '<P>', summary: M('Render the review packet for a phase.', '해당 페이즈의 리뷰 패킷을 렌더링한다.') },
      { name: 'rtm', summary: M('Render the requirements traceability matrix.', '요구사항 추적 매트릭스를 렌더링한다.') },
      { name: 'hub', summary: M('Render the artifact hub (document registry + artifact URLs).', '산출물 허브(문서 레지스트리 + 아티팩트 URL)를 렌더링한다.') },
    ],
  },
  {
    name: 'doc',
    summary: M('Document registry — the artifacts a gate reviews.', '문서 레지스트리 — 게이트가 심사하는 산출물.'),
    subs: [
      { name: 'upsert', args: '--id <DOC-x> --path <p> --phase <P>', summary: M('Register or update a document.', '문서를 등록·수정한다.') },
      { name: 'url', args: '<DOC-x> --url <artifact-url>', summary: M('Attach a published artifact URL to a document.', '문서에 게시된 아티팩트 URL 을 붙인다.') },
      { name: 'submit', args: '<DOC-x>', summary: M('Submit a document for review (pins its hash).', '문서를 심사에 올린다(해시 고정).') },
      { name: 'approve', args: '<DOC-x>', summary: M('Approve a submitted document.', '제출된 문서를 승인한다.') },
      { name: 'revise', args: '<DOC-x> [--path <p>]', summary: M('Revise an approved document (supersedes the old version).', '승인 문서를 개정한다(이전 버전 supersede).') },
      { name: 'stale', summary: M('List approved documents whose content no longer matches the pinned hash.', '승인 후 내용이 바뀐 문서를 나열한다.') },
      { name: 'list', summary: M('Print the whole registry as JSON.', '레지스트리 전체를 JSON 으로 출력한다.') },
    ],
  },
  {
    name: 'adr',
    summary: M('Architecture decision records tied to phase gates.', '페이즈 게이트에 묶인 아키텍처 결정 기록.'),
    subs: [
      { name: 'propose', args: '--id <ADR-x> --phase <P> --question <q> --option <id:title> ...', summary: M('Open a decision point with options.', '선택지를 가진 결정 포인트를 연다.') },
      { name: 'decide', args: '<ADR-x> --choose <id> --rationale <why> [--reject <id>:<why>]', summary: M('Record the decision and why the others were rejected.', '결정과 나머지를 버린 이유를 기록한다.') },
      { name: 'revise', args: '<ADR-x> --question <q>', summary: M('Reopen a decided ADR (supersedes it).', '결정된 ADR 을 다시 연다(supersede).') },
      { name: 'show', args: '<ADR-x>', summary: M('Render one ADR.', 'ADR 하나를 렌더링한다.') },
      { name: 'list', summary: M('Print all ADRs as JSON.', '전 ADR 을 JSON 으로 출력한다.') },
    ],
  },
  {
    name: 'design',
    summary: M('Claude Design canvas link — UX nodes, sync and baselines.', 'Claude Design 캔버스 연동 — UX 노드·동기화·기준선.'),
    subs: [
      { name: 'link', args: '--ux <UX-x> --url <canvas-url> [--artboard <name>]', summary: M('Link a UX node to a canvas artboard.', 'UX 노드를 캔버스 아트보드에 연결한다.') },
      { name: 'sync', args: '<UX-x> --from <file>', summary: M('Sync fetched canvas content into the ledger.', '가져온 캔버스 내용을 원장에 반영한다.') },
      { name: 'inventory', args: '--from <file>', summary: M('Extract a component inventory from canvas content.', '캔버스 내용에서 컴포넌트 목록을 뽑는다.') },
      { name: 'baseline', args: '<UX-x> --png <file>', summary: M('Record a baseline screenshot for a UX node.', 'UX 노드의 기준선 스크린샷을 기록한다.') },
      { name: 'html', args: '<UX-x>', summary: M('Render the linked artboard as standalone HTML.', '연결된 아트보드를 자체완결 HTML 로 렌더링한다.') },
      { name: 'list', summary: M('Print all canvas links as JSON.', '전 캔버스 링크를 JSON 으로 출력한다.') },
    ],
  },
  {
    name: 'tokens',
    summary: M('Design tokens — generate, lint raw values, swap themes.', '디자인 토큰 — 생성·raw 값 검사·테마 교체.'),
    subs: [
      { name: 'gen', args: '[--out <dir>]', summary: M('Generate CSS/TS token files from the token source.', '토큰 원본에서 CSS/TS 토큰 파일을 생성한다.') },
      { name: 'lint', args: '<files...>', summary: M('Find raw colour/size literals that should be semantic tokens.', '시맨틱 토큰이어야 할 raw 색·크기 리터럴을 찾는다.') },
      { name: 'swap', args: '--with <theme.json> [--out <dir>]', summary: M('Regenerate tokens with an override theme.', '대체 테마로 토큰을 다시 생성한다.') },
    ],
  },
  {
    name: 'evidence',
    summary: M('Visual evidence for UX waves — spec, check and packet.', 'UX 웨이브의 시각 증적 — 사양·검사·패킷.'),
    subs: [
      { name: 'spec', args: '<UX-x> [--wave <id>] [--out <path>]', summary: M('Write the capture spec an agent must satisfy.', '에이전트가 충족해야 할 캡처 사양을 쓴다.') },
      { name: 'check', args: '<wave-id>', summary: M('Check whether the wave has real (non-empty) capture evidence.', '웨이브에 실제(비어 있지 않은) 캡처 증적이 있는지 본다.') },
      { name: 'packet', args: '--ux <UX-x> [--wave <id>] [--out <path>]', summary: M('Render a before/after comparison packet.', '기준선 대비 비교 패킷을 렌더링한다.') },
    ],
  },
  {
    name: 'loop',
    summary: M('Wave execution loop — next work, attempts, briefs, escalation.', '웨이브 실행 루프 — 다음 작업·시도·브리프·소환.'),
    subs: [
      { name: 'next', summary: M('Print what to do next as JSON.', '다음에 할 일을 JSON 으로 출력한다.') },
      { name: 'attempt', args: '<wave-id> --outcome <pass|fail> [--detail <text>]', summary: M('Record one execution attempt and its outcome.', '실행 시도 한 번과 결과를 기록한다.') },
      { name: 'brief', args: '<wave-id> [--for <executor|verifier>]', summary: M('Render the sanitized brief handed to an agent.', '에이전트에게 넘길 중화된 브리프를 렌더링한다.') },
      { name: 'critical', args: 'raise --reason <r> [--wave <id>] [--detail <text>]', summary: M('Escalate to the human with a reason.', '사유와 함께 사람을 소환한다.') },
    ],
  },
  {
    name: 'ship',
    summary: M('Ship track — defect ledger, deployments, final verdict.', '출하 트랙 — 결함 대장·배포 기록·최종 판정.'),
    subs: [
      { name: 'defect', args: '<add|update|list> ...', summary: M('Defect ledger. Findings without evidence are refused.', '결함 대장. 근거 없는 지적은 거부된다.') },
      { name: 'deploy', args: '--env <env> --version <v> [--evidence <e>]', summary: M('Record a deployment.', '배포를 기록한다.') },
      { name: 'deployments', summary: M('Print deployment history as JSON.', '배포 이력을 JSON 으로 출력한다.') },
      { name: 'verdict', summary: M('Final go/no-go. Never passes without measured evidence.', '최종 go/no-go. measured 근거 없이는 통과하지 않는다.') },
      { name: 'checklist', summary: M('Render the release checklist.', '릴리스 체크리스트를 렌더링한다.') },
    ],
  },
  {
    name: 'profile',
    summary: M('Stack profile — what "build", "test", "deploy" mean here.', '스택 프로파일 — 이 저장소에서 빌드·테스트·배포가 무엇인지.'),
    subs: [
      { name: 'show', summary: M('Print the resolved profile as JSON.', '해석된 프로파일을 JSON 으로 출력한다.') },
      { name: 'cmd', args: '<key>', summary: M('Print one profile command.', '프로파일 명령 하나를 출력한다.') },
    ],
  },
  {
    name: 'usage',
    summary: M('Usage tier guidance for long sessions.', '긴 세션을 위한 사용량 티어 안내.'),
    subs: [
      { name: 'tier', args: '--percent <0-100>', summary: M('Print the tier and what to do at that usage level.', '티어와 그 수준에서 할 일을 출력한다.') },
      { name: 'status', summary: M('Print the cached usage state as JSON.', '캐시된 사용량 상태를 JSON 으로 출력한다.') },
    ],
  },
  {
    name: 'backtrack', args: '<P0..P12> --reason <why> | clear',
    summary: M('Officially go back to an earlier phase (the only way to edit approved design).', '공식 역행 — 승인된 설계를 고치는 유일한 경로.'),
  },
  { name: 'migrate', summary: M('Detect hand-rolled hooks/skills that would double-fire with the harness.', '하네스와 이중 발화할 자작 훅·스킬을 감지한다.') },
];

/**
 * 좌열 너비는 항목에서 계산한다 — 고정 폭이면 긴 인자 서식 하나가 표를 통째로 어긋나게 한다.
 * 너무 긴 좌열은 표를 밀어내므로 상한을 두고, 넘치면 설명을 다음 줄로 내린다.
 */
const MAX_LEFT = 30;

function table(rows: { left: string; summary: string }[]): string[] {
  const width = Math.min(MAX_LEFT, Math.max(...rows.map(r => r.left.length), 0));
  return rows.map(r => (r.left.length > width
    ? `  ${r.left}\n  ${' '.repeat(width)}  ${r.summary}`
    : `  ${r.left.padEnd(width)}  ${r.summary}`));
}

/** 최상위 사용법. `harness`·`harness --help`·`-h`·`help` 가 전부 여기로 온다. */
export function renderHelp(lang: Lang): string {
  const head = lang === 'ko'
    ? [
      'harness — 설계→구축→출하 규율을 훅으로 강제하는 하네스',
      '',
      '사용법: harness <명령> [하위명령] [옵션]',
      '',
      '핵심 흐름: init → 설계 산출물 작성 → gate submit → (사람) gate approve → phase set',
      '           → wave create/activate → 작업 → wave update → wave complete',
      '',
      '명령:',
    ]
    : [
      'harness — process discipline for AI coding, enforced by hooks rather than prompts',
      '',
      'Usage: harness <command> [subcommand] [options]',
      '',
      'Core flow: init → write design artifacts → gate submit → (human) gate approve → phase set',
      '           → wave create/activate → work → wave update → wave complete',
      '',
      'Commands:',
    ];
  // 최상위는 **이름만** 보여준다 — 인자 서식까지 넣으면 스캔이 안 된다. 상세는 군별 도움말로.
  const body = table(COMMANDS.map(g => ({
    left: g.subs ? `${g.name} <sub>` : g.name,
    summary: pick(g.summary, lang),
  })));
  const tail = lang === 'ko'
    ? [
      '',
      `자세히: harness <명령> --help   ·   버전: harness --version`,
      '언어: .harness/config.yaml 에 `lang: ko` 또는 환경변수 HARNESS_LANG=ko',
    ]
    : [
      '',
      'Details: harness <command> --help   ·   Version: harness --version',
      'Language: set `lang: ko` in .harness/config.yaml, or HARNESS_LANG=ko',
    ];
  return [...head, ...body, ...tail].join('\n');
}

export function findGroup(name: string): CommandGroup | undefined {
  return COMMANDS.find(g => g.name === name);
}

/** 명령군 도움말. 하위명령이 없으면 한 줄 설명만 낸다. */
export function renderGroupHelp(g: CommandGroup, lang: Lang): string {
  const out = [`harness ${g.name}${g.args ? ` ${g.args}` : ''} — ${pick(g.summary, lang)}`];
  if (g.subs?.length) {
    out.push('', lang === 'ko' ? '하위 명령:' : 'Subcommands:');
    out.push(...table(g.subs.map(s => ({
      left: s.args ? `${s.name} ${s.args}` : s.name,
      summary: pick(s.summary, lang),
    }))));
  }
  return out.join('\n');
}

/**
 * 「알 수 없는 하위 명령」 안내. 예전에는 각 case 가 목록을 손으로 적어 절반만 있었다(API-27).
 * 이제 레지스트리에서 나오므로 **모든 군이 똑같이** 안내한다.
 */
export function unknownSub(group: string, sub: string | undefined, lang: Lang): string {
  const g = findGroup(group);
  const names = g?.subs?.map(s => s.name).join(' | ') ?? '';
  const shown = sub === undefined ? (lang === 'ko' ? '(없음)' : '(none)') : sub;
  return lang === 'ko'
    ? `알 수 없는 ${group} 하위 명령: ${shown}${names ? ` — 가능: ${names}` : ''}\n\`harness ${group} --help\` 로 자세히 볼 수 있다.`
    : `Unknown ${group} subcommand: ${shown}${names ? ` — expected one of: ${names}` : ''}\nRun \`harness ${group} --help\` for details.`;
}

/** 최상위 미지 명령. 가능한 명령군을 함께 준다 — 막다른 골목을 만들지 않는다. */
export function unknownCommand(cmd: string, lang: Lang): string {
  const names = COMMANDS.map(g => g.name).join(' | ');
  const shown = cmd || (lang === 'ko' ? '(없음)' : '(none)');
  return lang === 'ko'
    ? `알 수 없는 명령: ${shown}\n가능: ${names}\n\`harness --help\` 로 전체 사용법을 볼 수 있다.`
    : `Unknown command: ${shown}\nExpected one of: ${names}\nRun \`harness --help\` for the full usage.`;
}
