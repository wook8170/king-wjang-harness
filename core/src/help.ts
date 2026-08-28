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
import { CRITICAL_REASONS } from './loop';
import { pick, type Lang, type Msg } from './i18n';
import { TOKEN_DOC_SKELETON, TOKEN_DOC_SHAPE_HINT } from './tokens';
import { DEFECT_STATUSES } from './ship';

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
  /**
   * [UTIL-B] 하위명령 표로는 못 말하는 것 — **입력 파일의 형태** 같은 것을 여기 적는다.
   * 요약 한 줄에 욱여넣으면 표가 깨지고, 적지 않으면 첫 시도가 반드시 실패한다.
   */
  note?: Msg;
}

const M = (en: string, ko: string): Msg => ({ en, ko });

export const COMMANDS: CommandGroup[] = [
  { name: 'init', summary: M('Create .harness/ and start the design track at P0.', '.harness/ 를 만들고 설계 트랙 P0 에서 시작한다.') },
  { name: 'status', summary: M('Print current phase, active wave, gates and backtrack as JSON.', '현재 페이즈·활성 웨이브·게이트·역행을 JSON 으로 출력한다.') },
  {
    name: 'doctor', args: '[--repair] [--force] [--accept-policy]',
    summary: M(
      'Diagnose state vs journal and policy drift; --repair replays state, --accept-policy re-pins '
      + 'the policy baseline (needs HARNESS_ACCEPT_POLICY=1 — humans only).',
      '상태·저널 정합과 정책 변경을 진단한다. --repair 는 저널 재생으로 상태를 복구하고, '
      + '--accept-policy 는 정책 베이스라인을 재고정한다(HARNESS_ACCEPT_POLICY=1 필요 — 사람만).',
    ),
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
      { name: 'submit', args: '<P> --paths <a,b> [--evidence claimed|code|measured]', summary: M('Submit artifacts for review; pins their hash and writes a review packet. Rejects empty or placeholder artifacts, and content that already opened another gate.', '산출물을 심사에 올린다. 해시를 고정하고 리뷰 패킷을 남긴다. 빈 문서·자리표시자와 이미 다른 게이트를 연 내용은 거부한다.') },
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
      { name: 'create', args: '--goal <text> [--milestone <m>] [--refs <ids>] [--acceptance|--accept <list>]', summary: M('Create a wave instruction sheet (pending). Design refs must exist in the ledger.', '웨이브 지시서를 만든다(pending). 설계 참조는 원장에 있어야 한다.') },
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
      { name: 'list', summary: M('Print the whole design ledger as JSON.', '설계 원장 전체를 JSON 으로 출력한다.') },
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
      { name: 'upsert', args: '--id <DOC-x> --path <p> --phase <P> [--refs <ids>] [--url <url>]', summary: M('Register or update a document. --refs links it to ledger nodes (RTM traceability).', '문서를 등록·수정한다. --refs 로 원장 노드에 연결한다(RTM 추적성).') },
      { name: 'url', args: '<DOC-x> <artifact-url>', summary: M('Attach a published artifact URL to a document.', '문서에 게시된 아티팩트 URL 을 붙인다.') },
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
      { name: 'gen', args: '[--out <dir>]', summary: M('Generate CSS/TS token files from the token source. Without --out they land in the project root (tokens.css, tokens.ts, tailwind.tokens.js).', '토큰 원본에서 CSS/TS 토큰 파일을 생성한다. --out 없이 부르면 프로젝트 루트에 떨어진다(tokens.css·tokens.ts·tailwind.tokens.js).') },
      { name: 'lint', args: '<files...>', summary: M('Find raw colour/size literals that should be semantic tokens.', '시맨틱 토큰이어야 할 raw 색·크기 리터럴을 찾는다.') },
      { name: 'swap', args: '--with <theme.json> [--out <dir>]', summary: M('Regenerate tokens with an override theme.', '대체 테마로 토큰을 다시 생성한다.') },
    ],
    // [UTIL-B] 원천 파일의 형태를 여기 적지 않으면 첫 시도가 반드시 실패한다 — 코어는
    // 기본값을 발명하지 않으므로(§7) 사람이 빈 화면에서 스키마를 알아맞혀야 했다.
    note: M(
      `Token source: .harness/design/tokens/design-tokens.json\n${TOKEN_DOC_SHAPE_HINT}\n\nA minimal valid document:\n${TOKEN_DOC_SKELETON}`,
      `토큰 원천: .harness/design/tokens/design-tokens.json\n${TOKEN_DOC_SHAPE_HINT}\n\n최소한의 유효 문서:\n${TOKEN_DOC_SKELETON}`,
    ),
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
      { name: 'critical raise',
        // [UTIL-A5·UX-102] `--reason` 은 enum 이다. `<r>` 로 적어 두면 안내대로 친 사람이
        // usage 에러를 만난다 — 도움말이 실제 계약을 그대로 보여야 한다.
        args: `--reason <${CRITICAL_REASONS.join('|')}> [--wave <id>] [--detail <text>]`, summary: M('Escalate to the human with a reason.', '사유와 함께 사람을 소환한다.') },
      // [UX-A1] 해제 명령이 도움말에 없어서, 소환된 사람이 **빠져나올 길을 찾을 수 없었다.**
      // 안내 문구는 실재하지 않는 `loop clear` 를 가리키고 있었다 — 막다른 길 두 겹.
      { name: 'critical clear', summary: M('Clear the escalation so the wave loop can run again.', '소환을 해제해 웨이브 루프를 다시 돌린다.') },
    ],
  },
  {
    name: 'ship',
    summary: M('Ship track — defect ledger, deployments, final verdict.', '출하 트랙 — 결함 대장·배포 기록·최종 판정.'),
    subs: [
      // [UX-A2] 인자를 적지 않으면 **알아낼 방법이 없다** — 미지 플래그 오류가 이 도움말을
      // 가리키는데 여기 인자가 없으면 그 안내도 막다른 길이 된다(같은 군의 deploy 는 이미 적고 있다).
      { name: 'defect add', args: '--id <id> --severity <blocker|high|medium|low> --title <one line> --evidence <path|run>', summary: M('Add a defect to the ledger. Findings without evidence are refused.', '결함을 대장에 올린다. 근거 없는 지적은 거부된다.') },
      { name: 'defect update', args: `<id> --status <${DEFECT_STATUSES.join('|')}> [--defer-reason <why>] [--evidence <e>]`, summary: M('Change a defect’s status.', '결함의 상태를 바꾼다.') },
      { name: 'defect list', summary: M('Print the defect ledger as JSON.', '결함 대장을 JSON 으로 출력한다.') },
      { name: 'deploy', args: '--env <env> --version <v> --sha <commit> [--evidence <e>]', summary: M('Record a deployment.', '배포를 기록한다.') },
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

/**
 * [UX-01] **설명이 넘치면 접어서 설명 칸에 맞춰 들여쓴다.**
 *
 * 예전에는 요약문을 패딩 뒤에 그대로 이어 붙였다. 짧은 요약은 문제없이 지나가지만 `doctor`(178자)·
 * `tokens gen`(173자)·토큰 문서 힌트(231자)는 실제 80열 터미널에서 둘째 줄부터 **왼쪽 끝으로
 * 돌아가** 어느 명령의 설명인지 시각적으로 추적할 수 없었다. 표가 표가 아니게 된다.
 *
 * 폭은 `process.stdout.columns` 를 쓰되 **비TTY(파이프·리다이렉트)면 고정값**이다 — 그래야
 * CI 로그와 테스트가 환경에 따라 흔들리지 않는다(결정성). 상·하한을 두는 이유는 아주 좁거나
 * 아주 넓은 터미널에서 접기가 오히려 읽기를 해치기 때문이다.
 */
const WRAP_MIN = 60;
const WRAP_MAX = 120;
const WRAP_FIXED = 100;                                   // 비TTY 기본 — 결정적이어야 한다

function wrapWidth(): number {
  // `COLUMNS` 를 먼저 본다 — 사람이 폭을 말해 준 것이고, 파이프 뒤에서도 검증할 수 있는
  // 유일한 손잡이다(비TTY 에서는 `process.stdout.columns` 가 없다).
  const env = Number(process.env.COLUMNS);
  const c = Number.isFinite(env) && env > 0
    ? env
    : (process.stdout.isTTY ? process.stdout.columns : undefined);
  if (typeof c !== 'number' || !Number.isFinite(c)) return WRAP_FIXED;
  return Math.max(WRAP_MIN, Math.min(WRAP_MAX, c));
}

/**
 * [UX-12] **터미널 폭은 글자 수가 아니라 「칸」이다.** 한글·CJK·전각 문장부호는 한 글자가
 * 두 칸을 차지한다. `str.length` 로 접으면 한국어 도움말이 실제로는 두 배 폭이 돼 80열에서
 * 넘친다 — 감사가 「코드에 있으나 호출 경로가 없다」고 남긴 잠재 결함인데, 접기를 넣는 순간
 * 그 경로가 **생긴다.** 그래서 여기서 함께 닫는다.
 */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const wide = (c >= 0x1100 && c <= 0x115f)          // 한글 자모
      || (c >= 0x2e80 && c <= 0xa4cf)                  // CJK 부수·한자·가나
      || (c >= 0xac00 && c <= 0xd7a3)                  // 한글 음절
      || (c >= 0xf900 && c <= 0xfaff)                  // CJK 호환
      || (c >= 0xfe30 && c <= 0xfe6f)                  // 세로쓰기 형태
      || (c >= 0xff00 && c <= 0xff60)                  // 전각 영숫자·문장부호
      || (c >= 0xffe0 && c <= 0xffe6)
      || (c >= 0x1f300 && c <= 0x1f9ff);               // 이모지
    w += wide ? 2 : 1;
  }
  return w;
}

/**
 * 낱말 하나가 폭보다 길 때 **자연 구분자에서** 더 쪼갠다.
 *
 * 두 부류가 여기 걸린다: ① `critical raise --reason <repeated-failure|backtrack-needed|…>`
 * 같은 **사용법 서식**(129칸), ② 공백이 드문 **한국어 구절**(`떨어진다(tokens.css·tokens.ts·…)`).
 * 아무 데서나 자르면 경로·플래그가 깨져 복붙이 안 되므로, 구분자 «뒤»에서만 끊는다.
 * 그래도 안 되면 그 조각은 그대로 둔다 — 넘치는 편이 뜻이 깨지는 것보다 낫다.
 */
function splitLongWord(word: string, width: number): string[] {
  if (displayWidth(word) <= width) return [word];
  const pieces: string[] = [];
  let cur = '';
  for (const part of word.split(/(?<=[|,/·、;])/)) {
    if (cur === '') cur = part;
    else if (displayWidth(cur) + displayWidth(part) <= width) cur += part;
    else { pieces.push(cur); cur = part; }
  }
  if (cur !== '') pieces.push(cur);
  return pieces;
}

/** 낱말 경계로 접는다. 넘치는 낱말은 `splitLongWord` 가 구분자에서 한 번 더 쪼갠다. */
function foldWords(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  const push = (): void => { if (line !== '') { out.push(line); line = ''; } };
  for (const raw of text.split(' ')) {
    for (const word of splitLongWord(raw, width)) {
      if (line === '') line = word;
      else if (displayWidth(line) + 1 + displayWidth(word) <= width) line += ` ${word}`;
      else { push(); line = word; }
    }
  }
  push();
  return out.length > 0 ? out : [''];
}

/**
 * note 는 **줄 단위로** 접는다. 원래 줄바꿈은 저자가 의도한 것이고, 그 안에 코드 예시가 있다.
 * 들여쓰기·중괄호·`"키":` 가 보이면 코드로 보고 **그대로 둔다** — 넘치는 편이 예시가
 * 깨지는 것보다 낫다(복붙해서 쓰라고 인쇄하는 것이다).
 */
function foldNote(text: string, width: number): string[] {
  return text.split('\n').flatMap(line => (
    /^\s/.test(line) || /[{}[\]]/.test(line) || /"\s*:/.test(line)
      ? [line]
      : foldWords(line, width)));
}

function table(rows: { left: string; summary: string }[]): string[] {
  const width = Math.min(MAX_LEFT, Math.max(...rows.map(r => r.left.length), 0));
  const indent = 2 + width + 2;                           // '  ' + 좌열 + '  '
  // 하한을 두면 좁은 터미널에서 **오히려 폭을 넘긴다**(indent + 하한 > 폭). 좁으면 좁은 대로 접는다.
  const room = Math.max(1, wrapWidth() - indent);         // 설명 칸에 남는 폭
  return rows.map(r => {
    const folded = foldWords(r.summary, room);
    const cont = folded.slice(1).map(l => `${' '.repeat(indent)}${l}`);
    if (r.left.length > width) {
      // 좌열 자체가 폭을 넘는 사용법 서식(`critical raise --reason <a|b|c…>` 은 129칸이었다).
      // 이어지는 조각은 서식 안쪽임을 보이게 네 칸 더 들여쓴다.
      const left = foldWords(r.left, Math.max(1, wrapWidth() - 2));
      const leftLines = [`  ${left[0]}`, ...left.slice(1).map(l => `      ${l}`)];
      return [...leftLines, `${' '.repeat(indent)}${folded[0]}`, ...cont].join('\n');
    }
    return [`  ${r.left.padEnd(width)}  ${folded[0]}`, ...cont].join('\n');
  });
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
      // [API-05] 종료코드 규약은 **문서화돼야 계약이다.** 예전에는 어느 문서에도 없었고,
      // 그래서 CI 가 「판정이 아니오」와 「명령이 못 돌았다」를 구분할 수 없었다.
      '종료코드: 0 성공/판정 예 · 1 사용법·환경 오류 · 2 판정이 아니오(verdict NO-GO ·',
      '          doctor 진단 실패 · gate verify 드리프트 · evidence check 미달)',
      `자세히: harness <명령> --help   ·   버전: harness --version`,
      '언어: .harness/config.yaml 에 `lang: ko` 또는 환경변수 HARNESS_LANG=ko',
    ]
    : [
      '',
      'Exit codes: 0 success · 1 usage or environment error · 2 the verdict is no',
      '            (ship verdict NO-GO · doctor found problems · gate verify drift)',
      'Details: harness <command> --help   ·   Version: harness --version',
      'Language: set `lang: ko` in .harness/config.yaml, or HARNESS_LANG=ko',
    ];
  return [...head, ...body, ...tail].join('\n');
}

/**
 * [USE-241] **명령군이 광고하는 플래그 어휘** — 도움말의 `args` 문자열이 정본이다.
 *
 * 예전에는 미지 플래그 판정이 **전역** 어휘(CLI 전체 ~30종)로 이뤄져서, 다른 명령군의
 * 플래그를 써도 「아는 플래그」로 통과한 뒤 **조용히 버려졌다** — `harness wave create
 * --goal g --reason r` 이 exit 0 으로 성공하고 `--reason` 만 사라진다. 가드 자신이
 * 「An unknown flag is never applied」라고 인쇄하면서 정확히 그 일을 하고 있었다.
 *
 * 어휘를 도움말에서 뽑는 이유: 그래야 **광고한 것과 받는 것이 같아진다.** 손으로 목록을
 * 하나 더 만들면 그것이 [ENG-235] 가 일곱 번 겪은 「두 번째 사본」이 된다.
 */
export function flagsOfGroup(g: CommandGroup): Set<string> {
  const out = new Set<string>();
  const collect = (text?: string): void => {
    if (!text) return;
    for (const m of text.matchAll(/--([a-z][a-z0-9-]*)/g)) out.add(m[1]);
  };
  collect(g.args);
  for (const sub of g.subs ?? []) collect(sub.args);
  return out;
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
  // [UX-01] note 도 접는다 — `tokens --help` 의 토큰 문서 힌트가 231자 한 줄이었다.
  // 단 **코드 예시는 접지 않는다**: note 안에는 JSON 골격이 들어 있고, 낱말 단위로 접으면
  // 그 예시가 통째로 뭉개진다(회귀 테스트 `tokens.test.ts` UTIL-B 가 잡았다 — 도움말이
  // 인쇄하는 골격이 실제 스키마와 같아야 한다는 계약이다).
  if (g.note) out.push('', ...foldNote(pick(g.note, lang), wrapWidth()));
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
/**
 * 편집 거리(삽입·삭제·치환). 오타 제안에만 쓰므로 전체 행렬 대신 두 줄만 들고 간다.
 * 명령 이름은 짧고 개수도 20 남짓이라 이 이상의 최적화는 값이 없다.
 */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * [UX-86] 오타에 **가까운 이름을 제안**한다. 전체 목록만 던지면 `stauts` 를 친 사람이
 * 20줄에서 `status` 를 눈으로 찾아야 한다 — 목록은 이미 있으므로, 없는 것은 「가장 가까운 것」이다.
 * 거리 임계는 이름 길이의 1/3(최소 1, 최대 3) — 넘기면 제안하지 않는다. **틀린 제안은
 * 제안 없음보다 나쁘다**(사람이 그것을 정답으로 믿고 다시 친다).
 */
export function nearestCommand(cmd: string): string | undefined {
  if (!cmd) return undefined;
  const lower = cmd.toLowerCase();
  const limit = Math.max(1, Math.min(3, Math.floor(lower.length / 3)));
  let best: { name: string; d: number } | undefined;
  for (const g of COMMANDS) {
    const d = editDistance(lower, g.name.toLowerCase());
    if (d <= limit && (best === undefined || d < best.d)) best = { name: g.name, d };
  }
  return best?.name;
}

export function unknownCommand(cmd: string, lang: Lang): string {
  const names = COMMANDS.map(g => g.name).join(' | ');
  const shown = cmd || (lang === 'ko' ? '(없음)' : '(none)');
  const near = nearestCommand(cmd);
  const hint = near === undefined ? '' : (lang === 'ko' ? `\n혹시 \`harness ${near}\`?` : `\nDid you mean \`harness ${near}\`?`);
  return lang === 'ko'
    ? `알 수 없는 명령: ${shown}${hint}\n가능: ${names}\n\`harness --help\` 로 전체 사용법을 볼 수 있다.`
    : `Unknown command: ${shown}${hint}\nExpected one of: ${names}\nRun \`harness --help\` for the full usage.`;
}
