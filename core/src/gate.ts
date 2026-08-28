/**
 * 게이트 — 페이즈 전환은 "작업 완료"가 아니라 "산출물 승인"으로만 일어난다(스펙 §2·§3-4·§4-3).
 *
 * 세 가지 계약:
 *  (1) 제출 없이 승인 없다. approveGate 는 submitted 상태만 연다. 출하 트랙(P10~P12)은
 *      `measured` 근거만 통과한다 — 실행·측정 없이 출하 게이트가 열리지 않는다(Iron Rule, §3-4).
 *  (2) 해시 고정. 제출 시점의 산출물 해시를 레코드에 박고, 이후 불일치는 게이트 자동 무효화로
 *      이어진다(§4-3.3). 승인 후 몰래 고친 문서로 다음 페이즈에 들어갈 수 없다.
 *  (3) 변이 순서. 모든 변이는 appendEvent 를 writeState 보다 먼저 수행한다(events.ts 의 순서 계약).
 *  (4) 심사 대상 검사(SEC-75). 예전에는 통과 기준이 「파일이 존재한다」뿐이었다 — **2바이트 파일
 *      한 장으로 12게이트를 전부 열 수 있었다**. 그러면 게이트는 검사가 아니라 의식이다.
 *      코어는 순수·로컬·결정적이라(§1) 내용의 **질**은 못 재지만, 아래 셋은 기계로 잰다:
 *        · 최소 실질성 — 빈 파일·공백뿐인 파일·자리표시자 도배를 거부(assertSubstantive)
 *        · 구별성 — 이미 다른 게이트를 연 **내용**으로 또 다른 게이트를 열 수 없다(assertDistinct).
 *          경로가 아니라 내용으로 잰다 — 실측에서 `cp a.md b.md` 한 줄이 경로 기반 판정을 뚫었다.
 *        · 페이즈 적합성 — 레지스트리가 아는 산출물은 제 페이즈에서만 심사된다(assertPhaseFit)
 *      **셋 다 과차단이 결함과 같은 무게다.** 사람이 정당한 소규모 산출물에 막히면 하네스를
 *      꺼버리고, 그 순간 방어는 0이 된다. 그래서 임계는 실측 하한 아래로 잡고(아래 상수 주석),
 *      판정은 파일 하나가 아니라 **제출 집합 전체**로 하며, 레지스트리 검사는 레지스트리가 그
 *      경로를 알 때만 작동한다. 탈출구(env·config)는 두지 않는다 — 임계가 틀렸다면 고칠 것은
 *      임계이지 우회로가 아니다.
 *
 *      **경계**: `--evidence measured` 가 참인지는 여기서 못 잰다. 측정을 다시 돌리는 것은
 *      코어의 능력 밖이다(네트워크·브라우저·실주행 = 에이전트 몫). 여기서 닫은 것은 그 주장의
 *      **가장 싼 형태** — 아무 내용도 없는·이미 다른 게이트가 쓴·페이즈가 어긋난 산출물로
 *      measured 를 주장하는 경로다.
 *
 *      **잔존 부류를 정확히 적는다**(적대적 검증이 실측했다 — [SEC-79]): 「한 글자 덧붙이기」가
 *      아니라 **실 산출물이 아예 없어도 열린다.** 서로 다른 필러 파일 13장(각 80자, 총 1KB)이면
 *      13게이트 전건 통과 → `ship verdict` GO → `doctor` issues 0 이다. 비용이 40배 올랐을 뿐
 *      부류가 닫히지는 않았다. 게다가 그 최저가 경로는 이 파일이 **과차단 가드로 고정한 조합**의
 *      상위집합이다 — 「막으면 안 되는 것」과 우회로가 같은 메커니즘을 쓴다. 내용의 질을 재는 것은
 *      코어(순수·로컬·결정적) 밖이므로, 여기서 닫을 수 있다고 쓰지 않는다. 남은 방어는 사람의
 *      승인이며 그것이 실제로 사람인지는 §4-3 권한 다이얼로그가 지킨다.
 *
 * 심사 대상 경로는 **저널에 산다**. GateRecord(types.ts)에는 paths 필드가 없고 게이트 하나를
 * 위해 상태 타입을 넓히지 않기로 했으므로, submit 이 남긴 `gate-submitted` 이벤트의 data.paths 를
 * 승인·검증 때 되읽어(recordedPaths) 같은 파일 집합으로 해시를 재계산한다. "이벤트가 진실,
 * state 는 파생 캐시"라는 원칙과 같은 방향이며, 재제출하면 가장 최근 제출분이 이긴다.
 *
 * 저널 폴드는 **배선돼 있다** — `replayState` 가 `evidence`·`submittedAt` 을 폴드하고
 * `gate-invalidated` 도 `KNOWN_EVENT_TYPES` 에 있다([LOGIC-21]·[LOGIC-56]·[OPS-55] 가 닫았다).
 *
 * [ENG-157] 여기에는 오래 「아직 미배선」이라고 적혀 있었고 **현재 사실과 정반대였다.**
 * 계약 문서가 거짓이면 다음 수리자가 이미 있는 것을 다시 만든다 — 낡은 주석은 없는 주석보다
 * 비싸다. 이 종류가 다시 생기지 않도록, 실제로 발행하는 이벤트가 전부 등록돼 있는지를
 * `core/test/eng-3i-residuals.test.ts` 가 전수 대조한다.
 */
import * as crypto from 'node:crypto';
import { updateHashEntry } from './hash';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendEvent, readEvents } from './events';
import { tr } from './tr';
import type { Msg } from './i18n';
import { packetsDir, isInsideRoot } from './paths';
import { computePolicyHash } from './policy';
import { sanitizeUntrusted } from './untrusted';
import { loadRegistry } from './registry';
import { readState, writeState } from './state';
import { PHASES, SHIP_PHASES, isEvidenceGrade } from './types';
import type { EvidenceGrade, GateRecord, HarnessState, Phase } from './types';

/**
 * 심사 대상 하나를 **파일 정체성**으로 환원한다 — 루트 실경로 기준 상대경로.
 *
 * 같은 파일을 다르게 적으면 경로 문자열이 갈리고, 그러면 한 장이 두 장으로 세어져 실질성·해시가
 * 어긋난다. realpath 는 심링크·중복 구분자·`..`·`./` 를 디스크상의 정본 하나로 모은다.
 *
 * **realpath 가 접지 못하는 것**: macOS 의 realpath(3) 는 대소문자를 정본화하지 않아
 * `DOCS/a.md` 는 그대로 남고, 하드링크·복사본은 애초에 다른 파일이다. 그 계열은 여기서가 아니라
 * `contentDigest`(내용 기반 구별성)가 막는다 — 실측으로 그렇게 갈렸다.
 *
 * 해석 실패(없는 파일)나 루트 밖은 **적힌 그대로** 돌려준다 — 존재 여부는 readArtifact 가,
 * 루트 밖은 assertInsideRoot 가 각자의 문구로 말해야 하기 때문이다(여기서 삼키면 사유가 바뀐다).
 */
/** [ENG-294] 「글자도 숫자도 아닌 것」 — 같은 규칙이 이 파일에 두 벌이었다. */
const NON_ALNUM_RE = /[^\p{L}\p{N}]/gu;

function canonicalRel(root: string, rel: string): string {
  try {
    const real = fs.realpathSync(path.resolve(root, rel));
    const r = path.relative(fs.realpathSync(root), real);
    return r && !r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r) ? r : rel;
  } catch {
    return rel;
  }
}

/**
 * 중복·공백을 걷고 정렬한다 — 같은 **파일 집합**은 입력 순서·표기와 무관하게 같은 해시여야 한다.
 * 정규화 뒤에 중복을 걷는 순서가 중요하다: `docs/a.md` 와 `./docs/a.md` 는 한 장이다.
 */
function normalizePaths(root: string, relPaths: string[]): string[] {
  const canon = relPaths.map(p => p.trim()).filter(Boolean).map(p => canonicalRel(root, p));
  return [...new Set(canon)].sort();
}

/**
 * 최소 실질성 임계 — **제출 집합 전체**의 공백 제외 문자 수.
 *
 * 근거(실측 세 점):
 *  · 이 리포의 실제 산출물 55개 중 최소가 213자(`profiles/nextjs-prisma/commands.yaml`),
 *    사람이 읽는 최소 리뷰 문서가 525자다 → 임계는 213 아래여야 정당한 소규모 산출물을 안 막는다.
 *  · **정당하게 짧은 한국어 문단 3문장이 91자다**(mcp.test.ts 의 설계 픽스처). 처음 잡았던 120은
 *    이것을 막았다 — 그래서 내렸다. 임계를 정할 때 실제로 재보지 않았다면 그건 추측이다.
 *  · 측정된 공격은 2바이트다.
 * 80 은 91 아래·213 아래이면서 공격의 40배다. 제목 한 줄(`# 컨셉` = 3자)·한 줄 색인(7자)은 여전히 막힌다.
 *
 * 바이트가 아니라 **문자**로 세는 이유: 한국어는 문자당 3바이트라 바이트 임계는 언어마다 다른
 * 분량의 문서를 요구하게 된다.
 *
 * 파일 하나가 아니라 집합으로 재는 이유: 큰 본문 + 작은 색인처럼 정당한 조합을 쪼개서 재면
 * 색인 파일 하나 때문에 전체가 막힌다(= 과차단).
 */
export const MIN_SUBSTANCE_CHARS = 80;

/**
 * [SEC-79] **길이만 채운 도배를 구조로 잡는다.** `MIN_SUBSTANCE_CHARS` 를 넘기는 가장 싼 길은
 * 한 글자를 80번 치는 것이었고, 그렇게 만든 필러 13장으로 13게이트가 열렸다(실측).
 *
 * 여기서 재는 것은 **질이 아니라 구조**다 — 「좋은 문서인가」는 순수·로컬·결정적 코어 밖이지만
 * 「이것이 산문인가」는 셀 수 있다. 두 지표를 **AND** 로 묶는 것이 핵심이다. 하나만 쓰면 곧 과차단이다:
 *  - 글자 다양성만 보면 **숫자 위주 표**(자릿수 10종 + 구분자)가 걸린다
 *  - 낱말 수만 보면 **띄어쓰기 없는 일본어·중국어 문서**가 통째로 걸린다
 * 둘 다 바닥일 때만 거부하므로, 어느 언어의 어느 산문도 이 문에 걸리지 않는다.
 *
 * 하한은 이 리포 실산출물에서 잡았다 — 최소 산출물(213자)은 고유 글자 40+·낱말 30+ 이고
 * 정당한 한국어 3문장(91자)도 고유 글자 30+ 다. 12·5 는 그 훨씬 아래이면서 공격(2·1)의 위다.
 */
export const MIN_DISTINCT_CHARS = 12;
export const MIN_WORDS = 5;

/** 글자·숫자만 남긴 고유 코드포인트 수 — 스크립트에 중립적이다(한글·가나·한자 모두 잘 늘어난다). */
export function distinctCharCount(text: string): number {
  return new Set(text.replace(NON_ALNUM_RE, '')).size;
}

/** 공백으로 끊은 낱말 수 — 띄어쓰기가 없는 언어에서는 작게 나오므로 **단독 판정에 쓰지 않는다**. */
export function wordCount(text: string): number {
  return text.split(/\s+/u).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * 자리표시자 어휘. 길이만 채운 문서를 잡는다 — 이 토큰들과 구두점·기호를 걷어내고 **아무 글자도
 * 남지 않을 때만** 거부한다. 진짜 문서에는 평범한 낱말이 남으므로 오탐이 사실상 없다.
 */
const PLACEHOLDER_WORDS =
  /\b(?:to-?do|tbd|tba|fixme|wip|xxx|n\/?a|none|nil|null|placeholder|lorem|ipsum|dolor|sit|amet|stub|draft|tk)\b/gi;
const PLACEHOLDER_WORDS_KO = /(?:미지정|미정|없음|추후|추가예정|작성예정|자리표시자|채워넣기|해당없음)/g;

interface ArtifactRead {
  rel: string;
  text: string;
  /** 공백을 제외한 코드포인트 수. 바이너리는 utf8 대체문자로 세어져 0 이 되지 않는다. */
  substance: number;
  /**
   * utf8 로 온전히 읽히지 않는 내용(스크린샷·PDF 등). 자리표시자 판정에서 제외한다 —
   * 대체문자 U+FFFD 는 글자도 숫자도 아니라 **잔여가 비어 「자리표시자뿐」으로 오판된다**.
   * 실측에서 라틴 문자가 없는 바이트열(0x80~0xFF)이 실제로 그렇게 거부됐다.
   */
  binary: boolean;
}

/** 산출물 하나를 읽는다. 부재는 경로를 밝히며 던진다 — 해시 계산과 실질성 검사가 같은 문구를 쓴다. */
function readArtifact(root: string, rel: string): Buffer {
  try {
    return fs.readFileSync(path.resolve(root, rel));
  } catch {
    throw new Error(
      tr(root, {
        en: `Cannot read the artifact under review: ${rel} — check the path, or write the document first`,
        ko: `심사 대상 산출물을 읽을 수 없다: ${rel} — 경로를 확인하거나 문서를 먼저 만들어라`,
      }),
    );
  }
}

function readArtifacts(root: string, relPaths: string[]): ArtifactRead[] {
  return relPaths.map((rel) => {
    const text = readArtifact(root, rel).toString('utf8');
    return {
      rel,
      text,
      substance: text.replace(/\s+/gu, '').length,
      binary: text.includes('�') || text.includes('\0'),
    };
  });
}

/**
 * 최소 실질성 — 게이트가 「파일이 존재한다」로 열리지 않게 한다(SEC-75).
 * 파일 단위로는 **완전히 빈 것만** 거부하고(빈 파일이 심사 대상인 경우는 없다), 분량 판정은
 * 집합 전체로 한다. 셋 다 사람이 다음 수를 알 수 있게 수치와 경로를 문구에 담는다.
 */
function assertSubstantive(root: string, arts: ArtifactRead[]): void {
  const blank = arts.filter(a => a.substance === 0).map(a => a.rel);
  if (blank.length > 0) {
    throw new Error(
      tr(root, {
        en: `Empty artifact under review: ${blank.join(', ')} — a gate approves content, not filenames. `
          + 'Write the document, or drop the path from --paths',
        ko: `심사 대상이 비어 있다: ${blank.join(', ')} — 게이트는 파일 이름이 아니라 내용을 승인한다. `
          + '문서를 채우거나 --paths 에서 그 경로를 빼라',
      }),
    );
  }
  const total = arts.reduce((n, a) => n + a.substance, 0);
  if (total < MIN_SUBSTANCE_CHARS) {
    throw new Error(
      tr(root, {
        en: `The artifacts under review carry ${total} non-whitespace characters, below the `
          + `${MIN_SUBSTANCE_CHARS} minimum (paths: ${arts.map(a => a.rel).join(', ')}). `
          + 'A gate is a review, not a ceremony — submit the document that was actually written',
        ko: `심사 대상의 공백 제외 문자가 ${total}자로 최소치 ${MIN_SUBSTANCE_CHARS}자에 못 미친다 `
          + `(대상: ${arts.map(a => a.rel).join(', ')}). `
          + '게이트는 의식이 아니라 심사다 — 실제로 작성된 문서를 제출하라',
      }),
    );
  }
  // 길이만 채운 도배를 잡는다. 자리표시자 어휘와 글자가 아닌 것을 모두 걷어낸 잔여가 비면
  // 「무엇을 심사할지」가 문서에 없다는 뜻이다. 바이너리는 애초에 이 규칙의 대상이 아니다
  // (판정에 넣으면 스크린샷 증적이 자리표시자로 오판된다 — 실측으로 확인).
  const textual = arts.filter(a => !a.binary);
  const residual = textual.map(a => a.text).join('\n')
    .replace(PLACEHOLDER_WORDS, '')
    .replace(PLACEHOLDER_WORDS_KO, '')
    .replace(NON_ALNUM_RE, '');
  if (textual.length > 0 && residual.length === 0) {
    throw new Error(
      tr(root, {
        en: `The artifacts under review are placeholders only (TODO/TBD and the like): `
          + `${textual.map(a => a.rel).join(', ')} — a placeholder is not grounds for approval`,
        ko: `심사 대상이 자리표시자뿐이다(TODO·TBD·미지정 따위): `
          + `${textual.map(a => a.rel).join(', ')} — 자리표시자는 승인 근거가 되지 못한다`,
      }),
    );
  }
  // [SEC-79] 산문이 아닌 것을 거부한다 — 글자 다양성과 낱말 수가 **동시에** 바닥일 때만.
  // 바이너리는 이 규칙의 대상이 아니다(자리표시자 검사와 같은 이유).
  if (textual.length > 0) {
    const joined = textual.map(a => a.text).join('\n');
    const chars = distinctCharCount(joined);
    const words = wordCount(joined);
    if (chars < MIN_DISTINCT_CHARS && words < MIN_WORDS) {
      throw new Error(
        tr(root, {
          en: `The artifacts under review are not prose — ${chars} distinct letters/digits across `
            + `${words} word(s) (${textual.map(a => a.rel).join(', ')}). Padding a file to the character `
            + 'minimum is not a document; a gate reviews what the phase actually produced',
          ko: `심사 대상이 산문이 아니다 — 고유 글자·숫자 ${chars}종, 낱말 ${words}개 `
            + `(${textual.map(a => a.rel).join(', ')}). 최소 글자수를 채우려고 늘린 파일은 문서가 아니다 — `
            + '게이트는 그 페이즈가 실제로 만든 것을 심사한다',
        }),
      );
    }
  }
}

/**
 * **내용만의** 다이제스트 — 경로를 빼고 파일 내용의 집합으로만 정해진다.
 *
 * 구별성을 `artifactHash`(경로 포함)로 재면 얕다. 실측: `cp docs/a.md docs/b.md` 한 줄이면
 * 다음 게이트가 열렸고, 다른 디렉토리 복사·하드링크·대소문자 무시 파일시스템의 `DOCS/a.md` 도
 * 전부 열렸다(6종 중 6종). 게이트가 물어야 할 것은 「이 **내용**이 이미 도장을 받았나」다.
 *
 * 중복을 걷는 이유: 같은 문서를 이름만 바꿔 두 장으로 늘려 제출하는 것을 한 장과 같게 본다.
 * 정렬하는 이유: 파일 순서·이름에 흔들리면 안 된다.
 */
function contentDigest(root: string, relPaths: string[]): string {
  const each = relPaths.map(rel => crypto.createHash('sha256').update(readArtifact(root, rel)).digest('hex'));
  const h = crypto.createHash('sha256');
  for (const d of [...new Set(each)].sort()) h.update(`${d}\0`);
  return h.digest('hex');
}

interface Submission {
  /** 형태 불량이면 빈 배열 — 호출측은 이것을 「제출 이력 없음」으로 읽는다. */
  paths: string[];
  contentHash?: string;
}

/**
 * 페이즈별 **최신** 제출을 저널 한 번 훑어 모은다. 뒤에서 앞으로 가며 처음 만난 것이 최신이고,
 * 그 뒤로는 같은 페이즈를 건너뛴다 — 재제출하면 가장 최근 제출분이 이긴다.
 *
 * 최신 항목이 형태 불량이어도 **더 옛 제출로 내려가지 않는다**. 내려가면 사람이 방금 올린 것이
 * 아니라 예전 것에 승인 도장이 찍힌다 — 「제출 이력이 없다, 재제출하라」가 옳은 답이다.
 *
 * 페이즈마다 저널을 다시 읽지 않는 이유: 구별성 검사가 12페이즈를 훑으므로 그대로 두면 저널을
 * 12번 읽는다(긴 프로젝트에서 그대로 지연이 된다).
 */
function latestSubmissions(root: string): Map<Phase, Submission> {
  const out = new Map<Phase, Submission>();
  const events = readEvents(root);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'gate-submitted') continue;
    const phase = ev.data.phase as Phase;
    if (!PHASES.includes(phase) || out.has(phase)) continue;
    const raw = ev.data.paths;
    const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
    out.set(phase, typeof ev.data.contentHash === 'string'
      ? { paths, contentHash: ev.data.contentHash }
      : { paths });
  }
  return out;
}

/**
 * 구별성 — 이미 다른 게이트를 연 **내용**으로 또 다른 게이트를 열 수 없다(SEC-75).
 *
 * 같은 게이트의 재제출은 대상이 아니다(개정 루프는 정상 경로). 무효화된 게이트도 대상이 아니다 —
 * 그 도장은 이미 떨어졌으므로 같은 산출물을 다시 심사에 올릴 수 있어야 한다.
 *
 * 비교 값은 **제출 당시** 저널에 박힌 contentHash 다. 지금 디스크를 다시 읽어 비교하면 그 사이의
 * 표류가 판정을 흔든다 — 물어야 할 것은 「그때 도장 찍힌 내용」이다. contentHash 가 없는 옛 저널은
 * artifactHash 로 떨어진다(더 얕지만, 있는 정보로 할 수 있는 최선).
 */
function assertDistinct(
  root: string, phase: Phase, hash: string, contentHash: string, gates: HarnessState['gates'],
): void {
  const prior = latestSubmissions(root);
  const clash = PHASES.filter((p) => {
    if (p === phase) return false;
    const g = gates[p];
    if (!g || (g.status !== 'submitted' && g.status !== 'approved')) return false;
    const prev = prior.get(p);
    return prev?.contentHash ? prev.contentHash === contentHash : g.artifactHash === hash;
  });
  if (clash.length > 0) {
    throw new Error(
      tr(root, {
        en: `The same artifacts already opened gate ${clash.join(', ')} — byte-identical content cannot `
          + `stand in for ${phase} as well. Each gate reviews what that phase actually produced; `
          + 'submit the revised or new artifact',
        ko: `같은 산출물이 이미 게이트 ${clash.join(', ')} 를 열었다 — 바이트가 같은 내용이 ${phase} `
          + '까지 대신할 수는 없다. 게이트마다 그 페이즈가 실제로 만든 것을 심사한다 — '
          + '개정본이나 새 산출물을 제출하라',
      }),
    );
  }
}

/**
 * [SEC-79 계열] **이 제출이 새로 가져온 것이 최소치만큼은 있어야 한다.**
 *
 * [SEC-75] 는 「바이트가 같은 내용」만 막았다. 그래서 최저가 경로는 곧 옮겨갔다 — 진짜처럼
 * 보이는 문서 한 장을 끝 숫자만 바꿔 13장으로 만들면 13게이트가 전부 열리고 `ship verdict` 가
 * GO 를 냈다(실측).
 *
 * 처음에는 유사도 비율(양방향 0.9)로 막았는데, 임계값으로 답하면 **희석 경로**가 남는다:
 * 진짜 문서 한 장에 35자짜리 얇은 파일을 하나씩 덧붙이자 비율이 내려가며 게이트 5개가 열렸다.
 * 임계가 있는 한 그 아래로 지나가는 길도 있다. 그래서 **비율이 아니라 절대량**으로 답한다 —
 * 이미 심사받은 모든 게이트의 텍스트를 한 덩어리로 놓고, 이 제출이 **그 안에 없던 조각**을
 * `MIN_SUBSTANCE_CHARS` 만큼 가져오는지 본다. 첫 제출에 요구하는 것과 같은 잣대를 「새로 만든
 * 부분」에 대는 것이다.
 *
 * 이 하나로 세 가지가 함께 정리된다:
 *  - 한 글자만 바꾼 사본(새 조각 ~5) → 막힌다
 *  - 얇은 파일 덧붙이기(새 조각 ~35) → 막힌다. 희석해도 새 조각의 절대량은 늘지 않는다
 *  - **P6 총감사가 앞 페이즈 산출물을 동반 제출**(새 리포트 150자+) → 통과한다.
 *    상위집합 특례를 따로 둘 필요가 없다 — 동반 제출은 새 조각이 실제로 많기 때문에 통과한다.
 *
 * 바이너리는 대상이 아니다(스크린샷끼리 텍스트로 견주면 오탐). 텍스트가 하나도 없으면 건너뛴다.
 */
const SHINGLE = 5;

/** 표기 흔들림(공백·대소문자)에 흔들리지 않게 정규화한 5글자 조각 집합. */
function shingles(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/\s+/gu, ' ').trim();
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= norm.length; i++) out.add(norm.slice(i, i + SHINGLE));
  return out;
}

/** 텍스트 산출물만 이어 붙인다 — 바이너리는 이 판정의 대상이 아니다. */
function textualJoin(root: string, rels: string[]): string {
  return readArtifacts(root, rels).filter(a => !a.binary).map(a => a.text).join('\n');
}

function assertNewMaterial(
  root: string, phase: Phase, paths: string[], gates: HarnessState['gates'],
): void {
  let mine: Set<string>;
  try {
    mine = shingles(textualJoin(root, paths));
  } catch {
    return;                                     // 읽기 실패는 앞선 검사가 이미 말한다
  }
  if (mine.size === 0) return;                  // 바이너리뿐 — 이 잣대의 대상이 아니다
  const prior = latestSubmissions(root);
  const seen = new Set<string>();
  const seenGates: Phase[] = [];
  for (const p of PHASES) {
    if (p === phase) continue;                  // 같은 게이트 재제출은 개정 루프다(정상)
    const g = gates[p];
    if (!g || (g.status !== 'submitted' && g.status !== 'approved')) continue;
    const prev = prior.get(p);
    if (!prev || prev.paths.length === 0) continue;
    try {
      // **그때 도장 찍힌 내용**과 지금 디스크가 같을 때만 센다. 어긋나 있으면 그 게이트는
      // 이미 무효화 대상이라 비교할 근거가 없다.
      if (computeArtifactHash(root, prev.paths) !== g.artifactHash) continue;
      for (const sh of shingles(textualJoin(root, prev.paths))) seen.add(sh);
    } catch {
      continue;                                 // 산출물이 사라졌으면 세지 않는다
    }
    seenGates.push(p);
  }
  if (seenGates.length === 0) return;
  let fresh = 0;
  for (const sh of mine) if (!seen.has(sh)) fresh++;
  if (fresh < MIN_SUBSTANCE_CHARS) {
    throw new Error(
      tr(root, {
        en: `This submission carries only ${fresh} characters of text that gate `
          + `${seenGates.join(', ')} has not already reviewed — below the ${MIN_SUBSTANCE_CHARS} minimum. `
          + `Bringing earlier artifacts along is fine, but ${phase} has to add what ${phase} actually `
          + `produced; editing a few characters does not make a reviewed document a new one`,
        ko: `이 제출에서 게이트 ${seenGates.join(', ')} 가 이미 심사하지 않은 텍스트는 ${fresh}자뿐이라 `
          + `최소치 ${MIN_SUBSTANCE_CHARS}자에 못 미친다. 앞 산출물을 동반하는 것은 정상이다 — 다만 `
          + `${phase} 는 ${phase} 가 실제로 만든 것을 더해야 한다. 몇 글자를 고친다고 이미 심사받은 `
          + '문서가 새 문서가 되지는 않는다',
      }),
    );
  }
}

/** 레지스트리 경로 비교용 정규화 — `./docs/a.md` 와 `docs/a.md` 는 같은 산출물이다. */
const normRel = (p: string): string => path.normalize(p).replace(/^(?:\.[\\/])+/, '');

/**
 * 페이즈 적합성 — 레지스트리(§3-7)가 아는 산출물은 제 페이즈에서만 심사된다(SEC-75).
 *
 * **비대칭이 의도다.** 레지스트리가 그 경로를 하나도 모르면 통과시킨다 — 문서 등록은 아직
 * 선택 배선이고, 여기서 등록을 강요하면 레지스트리를 안 쓰는 프로젝트가 전부 막힌다(과차단).
 * 아는 경우에도 「전부 이 페이즈」가 아니라 「**하나라도** 이 페이즈」를 요구한다 — P6 총감사는
 * 자기 리포트와 함께 P0~P5 산출물을 동반해서 올리는 것이 정상이기 때문이다.
 *
 * **부분 등록도 면제한다**(적대적 검증이 잡은 과차단). 처음 판은 「하나도 등록 안 됐을 때만」
 * 면제라, 정작 막히는 것은 레지스트리를 **부분적으로** 쓰는 프로젝트였다 — 가장 흔한 이행 중
 * 상태다: 아직 등록 안 한 P6 감사 리포트에 등록된 P0~P5 산출물을 동반해 올리면 차단됐다.
 * 미등록 경로가 하나라도 섞여 있으면 그것이 이 페이즈의 산출물일 수 있으므로 통과시킨다.
 * 남는 차단은 **제출 전부가 등록돼 있고 그중 이 페이즈가 하나도 없는 경우** — 즉 다른 페이즈
 * 문서만으로 이 게이트를 여는 경우뿐이다. 잡으려던 것은 그것 하나다.
 */
function assertPhaseFit(root: string, phase: Phase, paths: string[]): void {
  const want = new Set(paths.map(normRel));
  const known = loadRegistry(root).docs.filter(d => want.has(normRel(d.path)));
  if (known.length === 0) return;
  if (new Set(known.map(d => normRel(d.path))).size < want.size) return;
  if (known.some(d => d.phase === phase)) return;
  const where = [...new Set(known.map(d => `${d.id}(${d.phase})`))].join(', ');
  throw new Error(
    tr(root, {
      en: `None of the artifacts under review is registered to ${phase} — the registry has them as `
        + `${where}. A document belonging to another phase cannot open this gate. Register the `
        + `${phase} artifact with \`harness doc upsert --id <DOC-x> --path <p> --phase ${phase}\``,
      ko: `심사 대상 중 ${phase} 로 등록된 산출물이 하나도 없다 — 레지스트리에는 ${where} 로 있다. `
        + `다른 페이즈의 문서로 이 게이트를 열 수는 없다. `
        + `\`harness doc upsert --id <DOC-x> --path <경로> --phase ${phase}\` 로 ${phase} 산출물을 등록하라`,
    }),
  );
}

/**
 * SEC-25: 심사 대상은 **이 저장소 안**이어야 한다.
 * 예전에는 `--paths ../../../etc/passwd` 도 제출·승인됐다. 정보가 새지는 않았지만(패킷은 해시만
 * 싣는다) 게이트의 존재 이유인 «심사한 것과 승인할 것이 같다»가 깨진다 — 승인 도장이 버전 관리
 * 밖 파일에 찍히고, 해시 감시가 리뷰어가 볼 수 없는 대상을 겨눈다. 웨이브 id 는 이미 검증하면서
 * 산출물 경로만 안 하던 **비대칭**이었다.
 */
function assertInsideRoot(root: string, paths: string[]): void {
  // [SEC-295] 위치 판정 규칙은 `paths.ts` 한 벌이다 — 여기서는 **게이트의 문구**만 낸다.
  const outside = paths.filter(p => !isInsideRoot(root, p));
  if (outside.length > 0) {
    throw new Error(
      tr(root, {
        en: `Artifacts under review must live inside the project — outside paths: ${outside.join(', ')}. `
          + 'A gate exists to guarantee «what was reviewed is what gets approved». You cannot stamp '
          + 'approval on a file the reviewer cannot see in the repository.',
        ko: `심사 대상은 프로젝트 안에 있어야 한다 — 루트 밖 경로: ${outside.join(', ')}. `
          + '게이트는 «심사한 것과 승인할 것이 같다»를 보장하는 장치다. 리뷰어가 저장소에서 볼 수 '
          + '없는 파일에는 승인 도장을 찍을 수 없다.',
      }),
    );
  }
}

/**
 * 산출물 집합의 SHA-256. 정렬된 (경로, 내용) 쌍만으로 결정된다 — 시각·순서·머신에 의존하지
 * 않아야 승인 시점과 사후 검증이 같은 값을 낸다. 레지스트리를 참조하지 않으므로 문서
 * 레지스트리 배선과 독립적이다(그 배선은 별도 작업).
 */
export function computeArtifactHash(root: string, relPaths: string[]): string {
  const h = crypto.createHash('sha256');
  for (const rel of normalizePaths(root, relPaths)) {
    // [ENG-186] 규율은 `hash.ts` 한 벌에서 온다 — 경로·길이·내용 사이의 구분자가
    // 없으면 서로 다른 파일 조합이 같은 바이트열이 되어 변조가 해시를 통과한다.
    updateHashEntry(h, rel, readArtifact(root, rel));
  }
  return h.digest('hex');
}

/** 저널에서 이 페이즈의 최신 제출 심사 경로를 되읽는다. 제출 이력이 없거나 불량이면 null. */
function recordedPaths(root: string, phase: Phase): string[] | null {
  const s = latestSubmissions(root).get(phase);
  return s && s.paths.length > 0 ? s.paths : null;
}

/**
 * [SEC-79] **승인자가 무엇을 승인하는지 볼 수 있게 한다.**
 *
 * 필러 13장으로 13게이트가 열리고 `ship verdict` 가 GO 를 낸 실측의 급소는 「검사가 약하다」가
 * 아니라 **사람이 승인 직전에 읽는 문서가 실제 제출물을 보여 주지 않는다**는 것이었다 —
 * 리뷰 패킷은 레지스트리에 등록된 문서만 실었고, 게이트에 올라간 경로는 어디에도 안 나왔다.
 * 내용의 **질**은 이 코어 밖이지만 **분량·다양성·존재**는 셀 수 있고, 그것을 사람 앞에 놓으면
 * 「80자짜리 13장」은 눈에 띈다. 판정은 여전히 사람이 한다(§4-3).
 *
 * 제출 이력이 없으면 null — 「아직 심사할 것이 없다」와 「비어 있다」는 다른 말이다.
 */
export interface ArtifactSignal {
  rel: string;
  /** 읽을 수 없으면 true — 나머지 수치는 0 이다. */
  missing: boolean;
  binary: boolean;
  substance: number;
  distinctChars: number;
  words: number;
}

export interface SubmissionSignals {
  paths: ArtifactSignal[];
  substance: number;
  distinctChars: number;
  words: number;
  /** 최소치 근처 — 막지 않는다. 「직접 열어 보라」는 신호다. */
  nearFloor: boolean;
}

export function submissionSignals(root: string, phase: Phase): SubmissionSignals | null {
  const rels = recordedPaths(root, phase);
  if (!rels) return null;
  const paths: ArtifactSignal[] = rels.map((rel) => {
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(root, rel)).toString('utf8');
    } catch {
      return { rel, missing: true, binary: false, substance: 0, distinctChars: 0, words: 0 };
    }
    return {
      rel,
      missing: false,
      binary: text.includes('\uFFFD') || text.includes('\0'),
      substance: text.replace(/\s+/gu, '').length,
      distinctChars: distinctCharCount(text),
      words: wordCount(text),
    };
  });
  const textual = paths.filter(p => !p.binary && !p.missing);
  const substance = textual.reduce((n, p) => n + p.substance, 0);
  const distinctChars = Math.max(0, ...textual.map(p => p.distinctChars), 0);
  const words = textual.reduce((n, p) => n + p.words, 0);
  return {
    paths,
    substance,
    distinctChars,
    words,
    // 2배·30 은 이 리포 실산출물(213자·고유 글자 40+)이 걸리지 않는 자리다 —
    // 정당한 문서가 매번 깃발을 달면 그 깃발은 곧 무시된다.
    nearFloor: textual.length > 0 && (substance < MIN_SUBSTANCE_CHARS * 2 || distinctChars < 30),
  };
}

export function submitGate(
  root: string, phase: Phase, opts: { paths: string[]; evidence: EvidenceGrade },
): GateRecord {
  const paths = normalizePaths(root, opts.paths);
  if (paths.length === 0) {
    throw new Error(
      tr(root, {
        en: `No artifacts to review — name the documents with \`harness gate submit ${phase} --paths <a,b>\`. `
          + 'A gate approves artifacts; it is not a declaration that work is done',
        ko: `심사 대상 산출물이 없다 — \`harness gate submit ${phase} --paths <경로,...>\` 로 `
          + '승인받을 문서를 지정하라. 게이트는 산출물 승인이지 작업 완료 선언이 아니다',
      }),
    );
  }
  // CLI 문자열이 그대로 들어오는 자리다 — 열거형 밖 값이 레코드에 박히면 출하 게이트
  // 판정(measured 비교)이 조용히 무력화된다.
  if (!isEvidenceGrade(opts.evidence)) {
    throw new Error(
      tr(root, {
        en: `Invalid evidence grade: ${String(opts.evidence)} (one of claimed, code, measured)`,
        ko: `유효하지 않은 근거 등급: ${String(opts.evidence)} (claimed, code, measured 중 하나)`,
      }),
    );
  }
  assertInsideRoot(root, paths);
  // SEC-75: 「파일이 존재한다」를 넘어 내용·구별성·페이즈 적합성을 본다. 순서는 사람이 먼저
  // 알아야 할 것부터다 — 문서가 비었는가 → 제 페이즈 산출물인가 → 이미 다른 게이트가 썼는가.
  // 전부 저널·상태를 건드리기 **전에** 던진다(실패한 제출은 흔적을 남기지 않는다).
  assertSubstantive(root, readArtifacts(root, paths));
  assertPhaseFit(root, phase, paths);
  const artifactHash = computeArtifactHash(root, paths);
  const contentHash = contentDigest(root, paths);
  const state = readState(root);
  assertDistinct(root, phase, artifactHash, contentHash, state.gates);
  assertNewMaterial(root, phase, paths, state.gates);
  const prevStatus = state.gates[phase]?.status ?? 'pending';
  // 재제출은 승인된 게이트도 다시 연다 — 개정된 산출물은 다시 심사받아야 한다.
  // 직전 상태는 이벤트에 남긴다(무엇이 닫혔다 다시 열렸는지가 감사 대상).
  // OPS-20: 저널을 **먼저** 쓰고 그 이벤트의 ts 를 상태에도 그대로 쓴다. 예전에는 두 곳이
  // 각자 `new Date()` 를 찍어 밀리초가 갈렸고, 그 차이 때문에 `doctor` 가 승인 이후 **영구히**
  // `gates 불일치` 를 보고했다 — 상시 빨간 진단은 진짜 드리프트를 덮는다.
  // contentHash 는 GateRecord 가 아니라 저널에만 실린다 — 구별성 판정에만 쓰이고 상태 타입을
  // 게이트 하나 때문에 넓히지 않는다(파일 머리말의 «경로는 저널에 산다»와 같은 판단).
  const ev = appendEvent(root, 'gate-submitted', {
    phase, artifactHash, contentHash, evidence: opts.evidence, paths, prevStatus,
  });
  const record: GateRecord = {
    status: 'submitted',
    artifactHash,
    evidence: opts.evidence,
    submittedAt: ev.ts,
  };
  writeState(root, { ...state, gates: { ...state.gates, [phase]: record } });
  return record;
}

/**
 * [ENG-143] **출하 트랙 measured-only 규칙 — 판정도 문언도 한 벌이다.**
 *
 * 예전에는 `approveGate`(승인 거부)와 `shipVerdict`(NO-GO 사유)가 같은 규칙을 각자 들고
 * 있었다. 강제 자체는 fail-safe 였지만 **문언이 갈리면 verdict 와 approve 가 서로 다른 말을
 * 한다** — 사람은 그때 덜 말하는 쪽을 믿는다. `ship.ts` 머리말이 「다시 구현하지 않는다」고
 * 선언해 둔 것과 코드가 어긋나 있던 것 자체가, 이 리포가 [LOGIC-93]·[API-92]·[ENG-106] 으로
 * 세 번 물린 「같은 규칙 두 벌」 패턴이다.
 *
 * 위반이면 사유 문자열을, 아니면 `null` 을 준다 — 던질지 모을지는 부르는 쪽이 정한다.
 */
export function measuredOnlyViolation(
  root: string,
  phase: Phase,
  evidence: string | undefined,
): string | null {
  if (!SHIP_PHASES.includes(phase) || evidence === 'measured') return null;
  return tr(root, {
    en: `Ship-track gate ${phase} only passes on measured evidence (currently: ${evidence ?? 'none'}) — `
      + 'resubmit with real-run measurements attached (Iron Rule, spec §3-4)',
    ko: `출하 트랙 게이트 ${phase} 는 measured 근거만 통과한다 (현재: ${evidence ?? '없음'}) — `
      + '실주행·측정 증적을 붙여 재제출하라 (Iron Rule, 스펙 §3-4)',
  });
}

export function approveGate(root: string, phase: Phase): GateRecord {
  const state = readState(root);
  const current = state.gates[phase];
  if (!current || current.status !== 'submitted') {
    throw new Error(
      tr(root, {
        en: `Gate ${phase} is not in an approvable state (currently: ${current?.status ?? 'pending'}) — `
          + `submit artifacts first with \`harness gate submit ${phase}\``,
        ko: `게이트 ${phase} 는 승인할 수 있는 상태가 아니다 (현재: ${current?.status ?? 'pending'}) — `
          + `\`harness gate submit ${phase}\` 로 산출물을 먼저 제출하라`,
      }),
    );
  }
  const notMeasured = measuredOnlyViolation(root, phase, current.evidence);
  if (notMeasured) throw new Error(notMeasured);
  const paths = recordedPaths(root, phase);
  if (!paths) {
    throw new Error(
      tr(root, {
        en: `No submission history for gate ${phase} in the journal — submit again with \`harness gate submit ${phase}\``,
        ko: `게이트 ${phase} 의 제출 이력이 저널에 없다 — \`harness gate submit ${phase}\` 로 다시 제출하라`,
      }),
    );
  }
  // 제출과 승인 사이에 산출물이 바뀌었다면 심사한 것과 승인할 것이 다르다 — 여기서 막지
  // 않으면 사람이 본 적 없는 내용에 승인 도장이 찍힌다.
  const artifactHash = computeArtifactHash(root, paths);
  if (artifactHash !== current.artifactHash) {
    throw new Error(
      tr(root, {
        en: `Artifacts for gate ${phase} changed after submission — what was reviewed is not what would `
          + `be approved. Resubmit with \`harness gate submit ${phase}\`, then approve`,
        ko: `게이트 ${phase} 의 산출물이 제출 이후 변경됐다 — 심사한 내용과 승인할 내용이 다르다. `
          + `\`harness gate submit ${phase}\` 로 재제출한 뒤 승인하라`,
      }),
    );
  }
  // OPS-20: 위 submitGate 와 같은 이유 — 이벤트의 ts 가 유일한 승인 시각이다.
  // OPS-76: 승인 시점의 **정책 해시를 함께 찍는다**(재고정은 하지 않는다 — policy.ts 결정 (1)).
  // 승인 도장은 산출물에 찍는 것이지 정책 변경에 찍는 것이 아니므로 베이스라인은 건드리지
  // 않되, 「이 게이트는 어떤 정책 아래에서 열렸나」는 나중에 저널만으로 답할 수 있어야 한다.
  const ev = appendEvent(root, 'gate-approved', {
    phase, artifactHash, evidence: current.evidence, paths, policyHash: computePolicyHash(root).hash,
  });
  const record: GateRecord = { ...current, status: 'approved', approvedAt: ev.ts };
  writeState(root, { ...state, gates: { ...state.gates, [phase]: record } });
  return record;
}

/**
 * FEAT-23: 리뷰 피드백 수집. 공개 README 4개 언어가 「캔버스 코멘트 스레드를 개정으로
 * 수집한다(`harness gate feedback`)」고 광고하는데 구현이 없었다.
 *
 * 코어는 순수·로컬·결정적이다(§1) — 캔버스에서 코멘트를 **가져오는 것**은 네트워크 일이라
 * 에이전트/CLI 몫이고, 여기서는 `design sync --from <파일>` 과 **같은 패턴**으로 가져온
 * 내용을 받아 기록한다. 그래야 아이패드에서 「검토 → 코멘트 → 개정 → 재제출」 루프가 닫힌다.
 *
 * 내용은 **신뢰 경계 밖**이다 — 리뷰 패킷은 승인 심사자와 모델이 읽는 지시 채널이므로
 * 줄마다 중화해서 넣는다(SEC-28 과 같은 한 벌).
 */
export function feedbackPath(root: string, phase: Phase): string {
  return path.join(packetsDir(root), `${phase}.feedback.md`);
}

export function recordGateFeedback(root: string, phase: Phase, raw: string): number {
  /**
   * [PROD-D] 저장 형식이 「한 코멘트 = 한 불릿」이라 아래에서 `- ` 를 다시 붙인다 —
   * 그런데 리뷰 코멘트를 **마크다운 목록 그대로 붙여넣는 것**이 가장 흔한 입력이라
   * `- - 코멘트` 가 기본값이 돼 있었다. 입력쪽 불릿은 벗겨서 정규화한다.
   */
  const stripBullet = (l: string): string => l.replace(/^\s*[-*+]\s+/, '');
  const lines = raw.split('\n')
    .map(l => stripBullet(sanitizeUntrusted(l)))
    .filter(l => l.trim());
  if (lines.length === 0) {
    throw new Error(
      tr(root, {
        en: `Nothing to collect — put the review comments in the file you pass to `
          + `\`harness gate feedback ${phase} --from <file>\`. Empty feedback is not revision grounds`,
        ko: `수집할 피드백이 비어 있다 — \`harness gate feedback ${phase} --from <파일>\` 의 파일에 `
          + '리뷰 코멘트를 담아라. 빈 피드백은 개정 근거가 되지 못한다',
      }),
    );
  }
  const ev = appendEvent(root, 'gate-feedback', { phase, count: lines.length });
  fs.mkdirSync(packetsDir(root), { recursive: true });
  fs.appendFileSync(
    feedbackPath(root, phase),
    `\n## ${ev.ts} — ${tr(root, { en: `${lines.length} comment(s)`, ko: `${lines.length}건` })}\n\n`
    + `${lines.map(l => `- ${l}`).join('\n')}\n`,
  );
  return lines.length;
}

export function readGateFeedback(root: string, phase: Phase): string {
  try { return fs.readFileSync(feedbackPath(root, phase), 'utf8'); } catch { return ''; }
}

export interface GateVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * 고정된 해시와 현재 산출물을 대조한다. 판정 함수이므로 던지지 않는다 — 파일 부재도
 * 사유를 담은 ok=false 다(무효화 사유로 그대로 쓰인다).
 */
export function verifyGate(root: string, phase: Phase): GateVerdict {
  const t = (m: Msg): string => tr(root, m);
  const g = readState(root).gates[phase];
  if (!g || g.status === 'pending') {
    return { ok: false, reason: t({
      en: `there is no record for gate ${phase} — it has not been submitted`,
      ko: `게이트 ${phase} 기록이 없다 — 제출 전이다`,
    }) };
  }
  if (g.status === 'invalidated') {
    return { ok: false, reason: g.invalidatedReason ?? t({
      en: `gate ${phase} is invalidated`, ko: `게이트 ${phase} 가 무효화된 상태다`,
    }) };
  }
  if (!g.artifactHash) {
    return { ok: false, reason: t({
      en: `gate ${phase} has no pinned artifact hash`, ko: `게이트 ${phase} 에 고정된 산출물 해시가 없다`,
    }) };
  }
  const paths = recordedPaths(root, phase);
  if (!paths) {
    return { ok: false, reason: t({
      en: `the submission history for gate ${phase} is not in the journal — resubmit`,
      ko: `게이트 ${phase} 의 제출 이력이 저널에 없다 — 재제출 필요`,
    }) };
  }
  let hash: string;
  try {
    hash = computeArtifactHash(root, paths);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (hash !== g.artifactHash) {
    return {
      ok: false,
      reason: t({
        en: `artifact hash mismatch — pinned ${g.artifactHash.slice(0, 12)} ≠ current ${hash.slice(0, 12)} `
          + `(paths: ${paths.join(', ')})`,
        ko: `산출물 해시 불일치 — 고정 ${g.artifactHash.slice(0, 12)} ≠ 현재 ${hash.slice(0, 12)} `
          + `(대상: ${paths.join(', ')})`,
      }),
    };
  }
  return { ok: true };
}

/**
 * 승인 후 산출물 변조 감지 → 게이트 자동 무효화(§3-4). 무효화된 페이즈 목록을 반환한다.
 * 페이즈 순서로 훑어 결과가 결정적이다. 뒤집을 게 없으면 저널도 state 도 건드리지 않는다.
 */
export function invalidateStaleGates(root: string): Phase[] {
  const state = readState(root);
  const invalidated: Phase[] = [];
  for (const phase of PHASES) {
    const g = state.gates[phase];
    if (!g || (g.status !== 'submitted' && g.status !== 'approved')) continue;
    const verdict = verifyGate(root, phase);
    if (verdict.ok) continue;
    const reason = verdict.reason ?? tr(root, {
    en: 'artifact verification failed', ko: '산출물 검증 실패',
  });
    // 순서 계약: 저널 먼저. 아래 writeState 는 이 루프가 끝난 뒤 한 번만 수행한다.
    appendEvent(root, 'gate-invalidated', { phase, prevStatus: g.status, reason });
    state.gates[phase] = { ...g, status: 'invalidated', invalidatedReason: reason };
    invalidated.push(phase);
  }
  if (invalidated.length > 0) writeState(root, state);
  return invalidated;
}

/**
 * 페이즈 진입 가부 판정 — 직전 페이즈의 게이트가 approved 여야 한다(§2). P0 은 시작점이라
 * 언제나 진입 가능. 전환은 하지 않는다: 판정과 변이를 분리해야 훅·CLI 가 같은 규칙을 읽고도
 * 각자 다른 시점에 쓸 수 있다.
 */
/**
 * [UTIL-A1] **그 페이즈 앞의 게이트가 전부 승인돼야 들어갈 수 있다.**
 *
 * 예전에는 **직전 하나만** 봤다. 그래서 P0 에서 미래 게이트를 선제출·선승인하면
 * (`gate submit P6` → `gate approve P6` → `phase set P7`) 세 명령으로 설계 트랙 전체를
 * 건너뛸 수 있었다 — P1~P5 는 pending 그대로다(실측). 제품은 `phase set --force` 를
 * env 로 잠가 「한 줄로 트랙 강제를 푸는 것」을 막는데, 이 경로는 **그 잠금 아래를 지나갔다.**
 *
 * 사고로도 났다: 어떤 페이즈 제출이 실패한 뒤 다음 페이즈를 제출·승인하면 빠진 게이트를
 * 아무도 말해 주지 않고 출하까지 갔다.
 *
 * 사람의 탈출구는 그대로 남는다 — `HARNESS_ALLOW_FORCE=1 harness phase set <P> --force`.
 * 그것이 **의도된 탈출구**이고(사람이 책임을 진다), 여기서 막는 것은 에이전트가 조용히
 * 지나가는 길이다. 그래서 사유 문구가 빠진 게이트를 **전부 이름으로** 말한다.
 */
export function canEnterPhase(root: string, phase: Phase): GateVerdict {
  const i = PHASES.indexOf(phase);
  if (i <= 0) return { ok: true };
  const gates = readState(root).gates;
  const missing = PHASES.slice(0, i).filter(p => gates[p]?.status !== 'approved');
  if (missing.length === 0) return { ok: true };
  // [UX-182] 괄호가 **처방과 다른 게이트**를 말하고 있었다 — 「가장 앞의 것부터」라고 하면서
  // 상태는 바로 앞 게이트(`prev`)의 것을 보여 줬다. 막힌 사람이 두 이름 사이에서 헤맨다.
  // 처방이 가리키는 게이트의 상태를 보여 준다 — 한 문장 안의 두 이름은 같아야 한다.
  const first = missing[0];
  const list = missing.join(', ');
  return {
    ok: false,
    reason:
      tr(root, {
        en: `Cannot move to ${phase} — ${missing.length} gate(s) before it are not approved: ${list} `
          + `(${first} is currently: ${gates[first]?.status ?? 'pending'}). Start with the earliest: `
          + `\`harness gate submit ${first}\` → \`harness gate approve ${first}\`. `
          + "A phase change happens on 'artifact approval', never on 'work finished' (spec §2). "
          + 'Approving a later gate does not stand in for the ones before it',
        ko: `${phase} 로 갈 수 없다 — 그 앞의 게이트 ${missing.length}개가 승인되지 않았다: ${list} `
          + `(${first} 는 현재 ${gates[first]?.status ?? 'pending'}). 가장 앞의 것부터 처리하라: `
          + `\`harness gate submit ${first}\` → \`harness gate approve ${first}\`. `
          + "페이즈 전환은 '작업 완료'가 아니라 '산출물 승인'으로만 일어난다(스펙 §2). "
          + '뒤 게이트를 승인한다고 앞 게이트를 대신하지는 못한다',
      }),
  };
}

/** canEnterPhase 통과 시에만 전환한다. 막힌 사유는 그대로 던져 사람이 다음 수를 알게 한다. */
export function setPhaseViaGate(root: string, phase: Phase): void {
  /**
   * [LOGIC-01] **승인 뒤에 고친 산출물로 다음 페이즈에 들어갈 수 없다 — 전환 시점에 다시 본다.**
   *
   * 이 파일 머리가 선언한 계약(「승인 후 몰래 고친 문서로 다음 페이즈에 들어갈 수 없다 /
   * 이후 불일치는 게이트 자동 무효화」)이 **설계 트랙 전이에서 성립하지 않았다.**
   * `canEnterPhase` 는 `gates[p].status === 'approved'` 만 보고 해시를 재검증하지 않았고,
   * `invalidateStaleGates` 는 **수동 `harness gate sweep` 한 곳에만** 배선돼 있었다.
   *
   * 그래서 실측으로 이렇게 됐다: 사람이 내용 X 를 승인 → 에이전트가 디스크를 Y 로 바꿈
   * (설계 영역 `docs/` 는 에이전트가 정당하게 쓰는 곳이다) → `phase set P1` 이 exit 0.
   * `gate verify` 는 드리프트를 정확히 탐지하는데도 **아무도 그것을 부르지 않았다.**
   *
   * **판정(`canEnterPhase`)이 아니라 변이(여기)에 둔다.** 판정은 순수해야 훅과 CLI 가 같은
   * 규칙을 읽고도 각자 다른 시점에 쓸 수 있다 — `invalidateStaleGates` 는 저널에 쓰므로
   * 판정 안에 두면 그 분리가 깨진다.
   */
  /**
   * **앞으로 갈 때만 본다.** 역행(`backtrack` 이 연 뒤로 가기)의 목적이 바로 「드리프트된
   * 산출물을 고치러 가는 것」이다. 뒤로 가는 길에서 드리프트를 이유로 막으면 **고치러 갈 수
   * 없게 되고**, 사용자는 그 자리에 갇힌다 — 제품이 스스로 인쇄하는 안내
   * (「돌아간 뒤, 설계 산출물을 고치고 무효가 된 게이트를 다시 제출하라」)와도 정면으로 어긋난다.
   * 회귀 테스트 `med-3j-residuals.test.ts` [UTIL-189] 가 이것을 잡았다.
   */
  const cur = PHASES.indexOf(readState(root).phase);
  const to = PHASES.indexOf(phase);
  if (to > cur) invalidateStaleGates(root);
  const verdict = canEnterPhase(root, phase);
  if (!verdict.ok) throw new Error(verdict.reason);
  appendEvent(root, 'phase-set', { phase, via: 'gate' }); // 순서 계약: 저널 먼저
  writeState(root, { ...readState(root), phase });
}
