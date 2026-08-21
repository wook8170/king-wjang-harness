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
 *      measured 를 주장하는 경로다. 한 글자 덧붙여 해시만 바꾸는 회피는 여전히 열려 있다.
 *
 * 심사 대상 경로는 **저널에 산다**. GateRecord(types.ts)에는 paths 필드가 없고 게이트 하나를
 * 위해 상태 타입을 넓히지 않기로 했으므로, submit 이 남긴 `gate-submitted` 이벤트의 data.paths 를
 * 승인·검증 때 되읽어(recordedPaths) 같은 파일 집합으로 해시를 재계산한다. "이벤트가 진실,
 * state 는 파생 캐시"라는 원칙과 같은 방향이며, 재제출하면 가장 최근 제출분이 이긴다.
 *
 * 알려진 미배선: events.ts 의 replayState 는 evidence·submittedAt·invalidated 를 폴드하지 않고
 * `gate-invalidated` 도 KNOWN_EVENT_TYPES 에 없다 — 게이트를 쓴 뒤 doctor 가 gates 발산과
 * 미지 이벤트를 보고한다. 저널 폴드 확장은 events.ts 소유 작업이라 여기서 손대지 않는다.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendEvent, readEvents } from './events';
import { tr } from './tr';
import type { Msg } from './i18n';
import { packetsDir } from './paths';
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
    .replace(/[^\p{L}\p{N}]/gu, '');
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

/** 레지스트리 경로 비교용 정규화 — `./docs/a.md` 와 `docs/a.md` 는 같은 산출물이다. */
const normRel = (p: string): string => path.normalize(p).replace(/^(?:\.[\\/])+/, '');

/**
 * 페이즈 적합성 — 레지스트리(§3-7)가 아는 산출물은 제 페이즈에서만 심사된다(SEC-75).
 *
 * **비대칭이 의도다.** 레지스트리가 그 경로를 하나도 모르면 통과시킨다 — 문서 등록은 아직
 * 선택 배선이고, 여기서 등록을 강요하면 레지스트리를 안 쓰는 프로젝트가 전부 막힌다(과차단).
 * 아는 경우에도 「전부 이 페이즈」가 아니라 「**하나라도** 이 페이즈」를 요구한다 — P6 총감사는
 * 자기 리포트와 함께 P0~P5 산출물을 동반해서 올리는 것이 정상이기 때문이다.
 */
function assertPhaseFit(root: string, phase: Phase, paths: string[]): void {
  const want = new Set(paths.map(normRel));
  const known = loadRegistry(root).docs.filter(d => want.has(normRel(d.path)));
  if (known.length === 0) return;
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
  // 심링크로 밖을 가리키는 경우까지 잡으려면 실경로로 비교해야 한다. 해석 실패(아직 없는
  // 파일 등)는 리터럴 경로로 판정한다 — 존재 여부는 computeArtifactHash 가 따로 말한다.
  const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
  const base = real(root);
  const outside = paths.filter(p => {
    const rel = path.relative(base, real(path.resolve(root, p)));
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  });
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
    const content = readArtifact(root, rel);
    // 경로·길이·내용 사이에 구분자를 넣는다. 경계 없이 이으면 서로 다른 파일 조합이 같은
    // 바이트열이 되어 변조가 해시를 통과할 수 있다.
    h.update(`${rel}\0${content.length}\0`);
    h.update(content);
  }
  return h.digest('hex');
}

/** 저널에서 이 페이즈의 최신 제출 심사 경로를 되읽는다. 제출 이력이 없거나 불량이면 null. */
function recordedPaths(root: string, phase: Phase): string[] | null {
  const s = latestSubmissions(root).get(phase);
  return s && s.paths.length > 0 ? s.paths : null;
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
  if (SHIP_PHASES.includes(phase) && current.evidence !== 'measured') {
    throw new Error(
      tr(root, {
        en: `Ship-track gate ${phase} only passes on measured evidence (currently: ${current.evidence ?? 'none'}) — `
          + 'resubmit with real-run measurements attached (Iron Rule, spec §3-4)',
        ko: `출하 트랙 게이트 ${phase} 는 measured 근거만 통과한다 (현재: ${current.evidence ?? '없음'}) — `
          + '실주행·측정 증적을 붙여 재제출하라 (Iron Rule, 스펙 §3-4)',
      }),
    );
  }
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
  const ev = appendEvent(root, 'gate-approved', { phase, artifactHash, evidence: current.evidence, paths });
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
  const lines = raw.split('\n').map(l => sanitizeUntrusted(l)).filter(l => l.trim());
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
export function canEnterPhase(root: string, phase: Phase): GateVerdict {
  const i = PHASES.indexOf(phase);
  if (i <= 0) return { ok: true };
  const prev = PHASES[i - 1];
  const g = readState(root).gates[prev];
  if (g?.status === 'approved') return { ok: true };
  return {
    ok: false,
    reason:
      tr(root, {
        en: `Cannot move to ${phase} — the gate for the previous phase ${prev} is not approved `
          + `(currently: ${g?.status ?? 'pending'}). Approve the artifacts: \`harness gate submit ${prev}\` → `
          + `\`harness gate approve ${prev}\`. `
          + "A phase change happens on 'artifact approval', never on 'work finished' (spec §2)",
        ko: `${phase} 로 갈 수 없다 — 직전 페이즈 ${prev} 의 게이트가 승인되지 않았다 `
          + `(현재: ${g?.status ?? 'pending'}). \`harness gate submit ${prev}\` → `
          + `\`harness gate approve ${prev}\` 로 산출물을 승인하라. `
          + "페이즈 전환은 '작업 완료'가 아니라 '산출물 승인'으로만 일어난다(스펙 §2)",
      }),
  };
}

/** canEnterPhase 통과 시에만 전환한다. 막힌 사유는 그대로 던져 사람이 다음 수를 알게 한다. */
export function setPhaseViaGate(root: string, phase: Phase): void {
  const verdict = canEnterPhase(root, phase);
  if (!verdict.ok) throw new Error(verdict.reason);
  appendEvent(root, 'phase-set', { phase, via: 'gate' }); // 순서 계약: 저널 먼저
  writeState(root, { ...readState(root), phase });
}
