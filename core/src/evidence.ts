/**
 * 시각 증적 서브시스템 (스펙 §3-5 — 요구 8).
 *
 * **이 모듈은 브라우저를 몰지 않는다.** 코어는 순수 로컬·네트워크 없음이고(§1), 실주행은
 * 에이전트의 능력이지 코어의 능력이 아니다. 그래서 역할이 셋으로 갈린다:
 *
 *  1. **생성** — 승인된 UX 노드를 Playwright 시나리오 소스(문자열)로 1:1 변환한다
 *     (`UX-7` → `e2e/ux-7.spec.ts`). 캡처 규율(**항상 headless, `deviceScaleFactor: 2`**)은
 *     문서상의 지침이 아니라 **생성된 코드에 박아서** 낸다. 지침으로만 두면 언젠가 누가 1x 로
 *     찍고, 1x 캡처는 원격 검토에서 글자가 뭉개져 **회귀를 눈으로 잡을 수 없다**.
 *  2. **검증** — 에이전트가 남긴 증적을 읽어 판정한다(빈 파일·PNG 헤더·픽셀 크기·형식).
 *  3. **조립** — 기준 이미지 vs 구현 캡처 비교 리뷰 패킷(P9)을 자기완결 HTML 로 만든다.
 *     이미지는 **base64 `data:` URI 로 임베드**한다 — 아티팩트 CSP 가 외부·상대 경로 이미지를
 *     막으므로, 링크로 두면 원격에서 빈 액자만 보인다.
 *
 * 그 사이(브라우저를 띄워 실제로 찍는 일)는 **에이전트가 한다**. 코어가 브라우저를 잡으면 훅
 * 경로가 오프라인·CI 환경에서 세션을 통째로 멈춰 세우고, 테스트가 외부 상태에 묶여 결정성을
 * 잃는다(design.ts 머리말의 같은 논리).
 *
 * **증적 인정 기준의 정본은 이 파일이다.** `completeWave` 의 UX 게이트는 `validateEvidence` 의
 * `usable` 을 그대로 쓴다(기준 한 벌 — [QUAL-104]). 디렉토리 제외가 핵심이다: `stat.size` 는
 * 디렉토리에서도 0 이 아니라 **빈 서브디렉토리 하나로 게이트가 통과**된다. 이 리포지토리는
 * 이미 그 부류에 한 번 물렸다.
 *
 * [QUAL-140] 예전에는 「형식·크기 **의심**은 집합에서 빼지 않고 `problems` 로만 보고한다」였다.
 * 그 절충으로 유효한 1×1 PNG 가 게이트를 열었다 — 같은 함수가 "too small" 이라고 적으면서.
 * **제품이 의심한다고 적은 것을 게이트가 무시하면 그 검사는 장식이다.** 이제 의심도 `usable`
 * 에서 뺀다. 과차단이 걱정이면 문턱을 실주행이면 반드시 넘는 값으로 잡을 일이지, 판정을
 * 무르게 할 일이 아니다. `hasMeasuredEvidence`(출하)도 **같은 세 조건**을 쓴다.
 *
 * NOTE(배선): 이 모듈은 이벤트를 쓰지 않는다(순수 생성·판정). CLI 배선 시 필요하면 호출측이
 * 저널에 남긴다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { evidenceDir } from './paths';
import { tr, langFor } from './tr';
import { pick, type Lang, type Msg } from './i18n';
import { readState } from './state';
import { getNode } from './ledger';
import { readWave } from './wave';
import { getBaseline } from './design';

/**
 * 생성물(Playwright 시나리오·비교 패킷)은 줄이 많아 언어를 진입점에서 한 번 해석해 넘긴다.
 * 위 `requireUxId`/`requireWaveId` 두 순수 검증기만 root 가 없어 영어 고정이다(각 주석 참조).
 */
type Tr = (m: Msg) => string;
const trFor = (lang: Lang): Tr => (m: Msg) => pick(m, lang);

// ─────────────────────────────────────────────────────────────────────────────
// 모델 · 상수
// ─────────────────────────────────────────────────────────────────────────────

export interface EvidenceFile {
  name: string;
  /** 절대 경로. */
  path: string;
  size: number;
  /** 소문자 확장자(점 없음). 확장자가 없으면 빈 문자열. */
  ext: string;
  /** PNG 이고 헤더를 읽을 수 있을 때의 실제 픽셀 크기. */
  dimensions?: { width: number; height: number };
}

export interface EvidenceReport {
  /**
   * `harness wave complete` 의 UX 게이트가 이 디렉토리로 열리는가 (= **인정 파일**이 1개 이상).
   *
   * [QUAL-104] 예전에는 「파일이 하나라도 있는가」였다. 그래서 9바이트 텍스트를 `mock.png` 로
   * 두면 이 함수가 "cannot read the PNG header" 를 **problems 에 적으면서도 ok:true** 를 냈고,
   * `wave complete` 는 그것을 통과시켰다 — 제품이 이미 가진 검사를 게이트가 부르지 않았다.
   * 이제 `usable` 이 게이트의 유일한 기준이고 `wave.ts` 도 이 값을 쓴다(기준 한 벌).
   */
  ok: boolean;
  files: EvidenceFile[];
  /**
   * [UX-160] 증적 디렉토리에서 **본 항목 수**(세지 않기로 한 것 포함, 디렉토리 자체가 없으면 0).
   *
   * 「거기 아무것도 없다」와 「거기 뭔가 있는데 세지 않는다」는 처방이 다르다. `files` 는
   * 0바이트·끊긴 심링크·서브디렉토리를 담기 전에 걸러 내므로 그 구분을 못 한다 —
   * 0바이트 캡처를 넣은 사람에게 "증적이 없다"고 말해 **방금 넣은 파일을 또 넣게** 했다.
   */
  entries: number;
  /**
   * **게이트를 열 수 있는 파일.** 세 조건을 전부 만족해야 한다 — 헤더가 읽히고, 빈 화면
   * 의심 크기가 아니고, 실제 화면 치수다.
   *
   * [QUAL-140] 예전에는 「크기가 수상하다는 **의심**은 여기서 빼지 않는다」였고, 그 절충으로
   * 1×1 PNG 가 게이트를 열었다. 과차단이 걱정이면 문턱을 **실주행이면 반드시 넘는 값**으로
   * 잡을 일이지(각 변 200px — 가장 좁은 뷰포트도 375px), 판정을 무르게 할 일이 아니다.
   */
  usable: EvidenceFile[];
  /** 세지 않은 것과 그 사유 + 셌지만 의심스러운 것. 조용히 버리는 항목은 하나도 없다. */
  problems: string[];
}

export interface PlaywrightSpecOptions {
  /** 캡처를 떨어뜨릴 웨이브. 생략하면 활성 웨이브(state.activeWave). */
  waveId?: string;
  /** 시나리오 진입 주소(baseURL 상대 가능). 기본 `/`. */
  url?: string;
  /** 수용 기준. 생략하면 웨이브 지시서의 acceptance 를 그대로 쓴다. */
  acceptance?: string[];
  /** **논리** 뷰포트. 실제 캡처 픽셀은 항상 이 값의 2배다(deviceScaleFactor: 2). */
  viewport?: { width: number; height: number };
}

export interface ComparisonPacketOptions {
  uxNodeId: string;
  waveId: string;
  /** 비교에 쓸 캡처 파일명. 생략하면 `ux-7.png` → 없으면 사전순 첫 PNG. */
  captureName?: string;
}

/**
 * 이보다 작은 PNG 는 "찍히긴 했는데 빈 화면"일 가능성이 높다. 2x 스크린샷은 아무리 단순한
 * 화면이라도 수십 KB 다 — 1KiB 미만은 실패한 캡처를 증적으로 통과시키는 전형적 경로다.
 *
 * [QUAL-140] 예전에는 「세지 않는 게 아니라 의심으로 보고하고 measured 판정에서만 뺀다」였다.
 * 그 절충이 게이트를 열었다 — 유효한 1×1 PNG(70B)로 `wave complete` 가 통과했고, 같은 파일에
 * `evidence check` 는 "too small" 이라고 **말하고 있었다.** 제품이 의심한다고 적은 것을
 * 게이트가 무시하면 그 검사는 장식이다([SEC-137] 의 「못 봤으니 통과」와 같은 구조).
 * 이제 **세지 않는다** — 게이트도 이 판정을 그대로 쓴다.
 */
const MIN_PNG_BYTES = 1024;

/**
 * [QUAL-140] **크기 문턱은 패딩으로 넘을 수 있으므로 치수로도 잰다.** 1×1 PNG 에 `tEXt`
 * 청크를 채우면 바이트 검사는 통과한다 — [SEC-137] 이 64KB 캡에서 실증한 바로 그 수법이다.
 * 치수는 화면을 실제로 그려야 커지므로 패딩으로 못 속인다.
 *
 * 값은 **실주행 화면이면 반드시 넘는 쪽**으로 잡는다 — 가장 좁은 모바일 뷰포트도 375px 라
 * 200px 아래로 찍히는 실제 화면은 없다. 과차단을 만들지 않는 것이 이 문턱의 조건이다.
 */
const MIN_PNG_EDGE = 200;

/** 증적 디렉토리에서 예상되는 형식 — 스크린샷·비디오·트레이스·리포트. 그 밖은 problems 로 보고. */
const EXPECTED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'webm', 'mp4', 'zip', 'json', 'html', 'txt', 'md',
]);

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ─────────────────────────────────────────────────────────────────────────────
// 검증 (입력)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 시나리오·기준 이미지는 UX 노드에만 붙는다(design.ts 의 같은 규칙). 경로 문자를 함께 막는
 * 이유는 이 id 가 파일명(`e2e/ux-7.spec.ts`)이 되기 때문이다 — `UX-../..` 이 통과하면
 * 생성물이 리포 밖에 떨어진다.
 */
function requireUxId(id: unknown): string {
  if (typeof id !== 'string' || !/^UX-[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(
      // i18n 예외: 순수 검증기라 root 가 없다(tokens.ts 상단 주석과 같은 판단). 영어 고정.
      `Visual evidence attaches to UX nodes only: ${String(id)} is not a usable UX node id. It must `
      + 'start with UX- and use only alphanumerics, . _ - (it becomes a filename, so no path characters).',
    );
  }
  return id;
}

/** 웨이브 id 는 증적 디렉토리 경로가 된다 — 경로 문자를 허용하면 evidence/ 밖으로 샌다. */
function requireWaveId(id: unknown): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id) || id === '.' || id === '..') {
    throw new Error(
      // i18n 예외: 순수 검증기라 root 가 없다. 영어 고정.
      `Invalid wave id: ${String(id)} — it must be an identifier using only alphanumerics, . _ - `
      + '(like `wave-001`); it becomes an evidence directory path, so no path characters.',
    );
  }
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. UX 노드 → Playwright 시나리오 1:1 변환
// ─────────────────────────────────────────────────────────────────────────────

/** `UX-7` → `e2e/ux-7.spec.ts` (스펙 §3-5). 리포 루트 기준 posix 경로다 — OS 경로가 아니다. */
export function specFileNameFor(uxNodeId: string): string {
  return `e2e/${requireUxId(uxNodeId).toLowerCase()}.spec.ts`;
}

/** `UX-7` → `ux-7.png`. 시나리오가 남기는 기본 캡처 이름 — 패킷이 이 이름을 먼저 찾는다. */
export function captureFileNameFor(uxNodeId: string): string {
  return `${requireUxId(uxNodeId).toLowerCase()}.png`;
}

/**
 * 홑따옴표 JS 문자열 리터럴. 생성물 전체의 따옴표 스타일을 하나로 유지한다 —
 * 리포의 린트 룰팩이 따옴표를 강제하는 순간 생성물만 매번 레드가 되기 때문이다.
 */
const js = (s: string) => `'${String(s)
  .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;

/** `//` 주석 한 줄에 안전하게 박기 — 개행이 들어오면 주석이 코드로 새어 나간다. */
const comment = (s: string) => String(s).replace(/[\r\n]+/g, ' ').trim();

/**
 * UX 노드 1개를 Playwright 시나리오 파일 소스로 변환한다. **순수·결정적**이다(같은 입력 →
 * 바이트 동일) — 시각·난수가 섞이면 "다시 생성했더니 diff 없음" 검사가 매번 레드가 되고,
 * 그 검사가 죽는 순간 사람이 생성물을 손으로 고치기 시작한다.
 *
 * 캡처 규율을 생성물에 박는 것이 이 함수의 존재 이유다 — headless(창이 뜨면 사용자 화면의
 * 포커스를 빼앗는다)와 `deviceScaleFactor: 2`(1x 는 원격에서 글자가 뭉개진다).
 */
export function generatePlaywrightSpec(
  root: string, uxNodeId: string, opts?: PlaywrightSpecOptions,
): string {
  requireUxId(uxNodeId);
  const waveId = resolveWaveId(root, opts?.waveId);
  const node = getNode(root, uxNodeId);
  const title = (node?.title ?? '').trim();
  const url = typeof opts?.url === 'string' && opts.url ? opts.url : '/';
  const vw = opts?.viewport?.width ?? 1440;
  const vh = opts?.viewport?.height ?? 900;
  const acceptance = opts?.acceptance ?? waveAcceptance(root, waveId);
  const capture = captureFileNameFor(uxNodeId);
  const testName = title ? `${uxNodeId} — ${title}` : uxNodeId;
  const t = trFor(langFor(root));

  const steps: string[] = [];
  if (acceptance.length === 0) {
    steps.push(
      `  // ${t({
        en: 'This UX node has no acceptance criteria — a scenario that only takes a screenshot is an alibi, not evidence.',
        ko: '이 UX 노드에 수용 기준이 없다 — 스크린샷만 남기는 시나리오는 증적이 아니라 알리바이다.',
      })}`,
      `  // TODO(${uxNodeId}): ${t({
        en: "fill in the wave instruction sheet's acceptance criteria, then regenerate.",
        ko: '웨이브 지시서의 수용 기준을 채운 뒤 다시 생성하라.',
      })}`,
      '  await expect(page.locator(\'body\')).toBeVisible();',
      '',
    );
  } else {
    acceptance.forEach((a, i) => {
      steps.push(
        `  // [${t({ en: `acceptance ${i + 1}`, ko: `수용 기준 ${i + 1}` })}] ${comment(a)}`,
        `  // TODO(${uxNodeId}): ${t({
          en: 'replace this with an assertion that actually verifies the criterion above. Do not manufacture green with a placeholder.',
          ko: '위 기준을 실제로 검증하는 단언으로 교체하라. placeholder 로 그린을 만들지 마라.',
        })}`,
        '  await expect(page.locator(\'body\')).toBeVisible();',
        '',
      );
    });
  }

  return [
    `// ${t({
      en: `Generated — ${specFileNameFor(uxNodeId)} can be re-emitted from ${uxNodeId}.`,
      ko: `생성물 — ${specFileNameFor(uxNodeId)} 는 ${uxNodeId} 에서 다시 찍어낼 수 있다.`,
    })}`,
    `// ${uxNodeId}${title ? ` "${comment(title)}"` : ''}${node
      ? ` (${t({ en: `ledger v${node.version}`, ko: `원장 v${node.version}` })})`
      : ''}`,
    `// ${t({
      en: '→ 1:1 conversion into a P7 Playwright scenario (spec §3-5).',
      ko: '→ P7 Playwright 시나리오 1:1 변환 (스펙 §3-5).',
    })}`,
    '//',
    `// ${t({
      en: 'The capture discipline is not a guideline — it is baked into this file:',
      ko: '캡처 규율은 지침이 아니라 이 파일에 박혀 있다:',
    })}`,
    `//   - ${t({
      en: 'always headless — a window stealing focus interrupts whatever the user is doing.',
      ko: '항상 headless — 창이 뜨면 사용자 화면의 포커스를 빼앗아 작업을 끊는다.',
    })}`,
    `//   - ${t({
      en: 'deviceScaleFactor: 2 — at 1x the text smears in remote review and regressions cannot be seen.',
      ko: 'deviceScaleFactor: 2 — 1x 캡처는 원격 검토에서 글자가 뭉개져 회귀를 눈으로 잡을 수 없다.',
    })}`,
    "import * as path from 'node:path';",
    "import { test, expect } from '@playwright/test';",
    '',
    `// ${t({
      en: "Evidence lands only in this wave's evidence directory — the UX gate of `harness wave complete` looks here.",
      ko: '증적은 이 웨이브의 증적 디렉토리로만 떨어진다 — `harness wave complete` 의 UX 게이트가 여기를 본다.',
    })}`,
    `// ${t({
      en: 'Paths are relative to the repo root (Playwright is assumed to run from the root holding its config).',
      ko: '경로는 리포 루트 기준이다(Playwright 는 설정 파일이 있는 루트에서 도는 것을 전제).',
    })}`,
    `const EVIDENCE_DIR = path.resolve(process.cwd(), '.harness', 'evidence', ${js(waveId)});`,
    '',
    'test.use({',
    '  headless: true,',
    '  deviceScaleFactor: 2,',
    `  viewport: { width: ${vw}, height: ${vh} }, // ${t({
      en: `logical size — the actual capture is ${vw * 2}x${vh * 2}px`,
      ko: `논리 크기 — 실제 캡처는 ${vw * 2}x${vh * 2}px`,
    })}`,
    '});',
    '',
    `test(${js(testName)}, async ({ page }) => {`,
    `  await page.goto(${js(url)});`,
    '',
    ...steps,
    `  await page.screenshot({ path: path.join(EVIDENCE_DIR, ${js(capture)}), fullPage: true });`,
    '});',
    '',
  ].join('\n');
}

function resolveWaveId(root: string, given?: string): string {
  if (given !== undefined) return requireWaveId(given);
  let active: string | null = null;
  try {
    active = readState(root).activeWave;
  } catch {
    active = null; // 상태를 못 읽는 것과 활성 웨이브가 없는 것을 같은 안내로 합친다
  }
  if (!active) {
    throw new Error(
      tr(root, {
        en: 'Cannot tell which wave the captures belong to — there is no active wave. Activate one with '
          // [UX-165] 「명시적으로 넘겨라」면서 **플래그명을 안 썼다** — 사람이 무엇을 칠지 모른다.
          + '`harness wave activate <id>`, or pass it explicitly with `--wave <wave-id>`.',
        ko: '캡처를 떨어뜨릴 웨이브를 알 수 없다 — 활성 웨이브가 없다. '
          + '`harness wave activate <id>` 로 활성화하거나 `--wave <wave-id>` 로 직접 넘겨라.',
      }),
    );
  }
  return requireWaveId(active);
}

/** 웨이브 지시서의 수용 기준. 읽을 수 없으면 빈 배열 — 생성 자체를 막지는 않는다. */
function waveAcceptance(root: string, waveId: string): string[] {
  try {
    return readWave(root, waveId).meta.acceptance;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 증적 검증
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PNG 헤더(IHDR)의 실제 픽셀 크기. **절대 throw 하지 않는다** — 증적 디렉토리에는 남이 넣은
 * 임의의 바이너리가 들어올 수 있고, 파일 하나가 판정 전체를 죽이면 안 된다. PNG 가 아니거나
 * 헤더가 깨졌으면 null(= "말할 수 없다")이다.
 */
export function pngDimensions(pngPath: string): { width: number; height: number } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(pngPath, 'r');
    const head = Buffer.alloc(24); // 시그니처 8 + 길이 4 + 'IHDR' 4 + width 4 + height 4
    if (fs.readSync(fd, head, 0, 24, 0) < 24) return null;
    if (!head.subarray(0, 8).equals(PNG_SIG)) return null;
    if (head.readUInt32BE(8) !== 13) return null; // IHDR 길이는 규격상 항상 13
    if (head.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    const width = head.readUInt32BE(16);
    const height = head.readUInt32BE(20);
    if (width === 0 || height === 0) return null;
    return { width, height };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 닫기 실패는 판정에 영향이 없다 */ }
    }
  }
}

/**
 * 2x 캡처인가.
 *
 * `expectedLogical`(시나리오가 선언한 논리 뷰포트)을 주면 **정확히** 2배인지 본다.
 * 주지 않으면 판단 근거가 픽셀 크기뿐이라 **필요조건만** 본다 — 2x 캡처의 픽셀 크기는 반드시
 * 짝수다(논리 크기 × 2). 즉 인자 없는 true 는 "2x 가 맞다"가 아니라 "1x 라고 단정할 수 없다"
 * 이므로, 논리 크기를 아는 호출측은 반드시 넘겨라.
 */
export function isTwoXCapture(
  pngPath: string, expectedLogical?: { width: number; height: number },
): boolean {
  const d = pngDimensions(pngPath);
  if (!d) return false;
  if (expectedLogical) {
    return d.width === expectedLogical.width * 2 && d.height === expectedLogical.height * 2;
  }
  return d.width % 2 === 0 && d.height % 2 === 0;
}

/**
 * 증적 디렉토리 판정. `files` 는 wave.ts 의 UX 게이트가 세는 집합과 같다(모듈 머리말).
 * 세지 않은 항목도, 셌지만 의심스러운 항목도 전부 `problems` 에 사유와 함께 남는다 —
 * 조용한 드롭은 "증적이 있는 줄 알았는데 없었다"를 만드는 가장 빠른 길이다.
 */
export function validateEvidence(root: string, waveId: string): EvidenceReport {
  const t = trFor(langFor(root));
  requireWaveId(waveId);
  const dir = evidenceDir(root, waveId);
  const files: EvidenceFile[] = [];
  const problems: string[] = [];
  /** [QUAL-104] 「자기가 주장하는 것이 아닌」 파일 이름 — 게이트 계산에서 뺀다. */
  const unusable = new Set<string>();

  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return {
      ok: false,
      files,
      entries: 0,
      usable: [],
      problems: [
        t({
          en: `the evidence directory is missing or unreadable: ${dir} — the UX gate opens only once a headless `
            + 'real run has left a 2x screenshot (spec §3-5).',
          ko: `증적 디렉토리가 없거나 읽을 수 없다: ${dir} — `
            + 'headless 실주행으로 2x 스크린샷을 남겨야 UX 게이트가 열린다(스펙 §3-5).',
        }),
      ],
    };
  }

  for (const name of names) {
    if (name.startsWith('.')) {
      problems.push(`${name}: ${t({
        en: 'dot files do not count as evidence',
        ko: 'dot 파일은 증적으로 세지 않는다',
      })}`);
      continue;
    }
    const abs = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      problems.push(`${name}: ${t({
        en: 'cannot stat it (a broken symlink?) — what cannot be counted is not evidence',
        ko: '상태를 읽을 수 없다(끊긴 심볼릭 링크?) — 셀 수 없는 것은 증적이 아니다',
      })}`);
      continue;
    }
    if (st.isDirectory()) {
      problems.push(t({
        en: `${name}/: a directory is not evidence — one empty subdirectory must not pass the UX gate. `
          + 'If there are files inside, move them directly under the evidence directory.',
        ko: `${name}/: 디렉토리는 증적이 아니다 — 빈 서브디렉토리 하나로 UX 게이트가 통과되면 안 된다. `
          + '안에 파일이 있다면 증적 디렉토리 바로 밑으로 옮겨라.',
      }));
      continue;
    }
    if (!st.isFile()) {
      problems.push(`${name}: ${t({
        en: 'not a regular file — it does not count as evidence',
        ko: '일반 파일이 아니다 — 증적으로 세지 않는다',
      })}`);
      continue;
    }
    if (st.size === 0) {
      problems.push(t({
        en: `${name}: 0 bytes — an empty capture does not fail a visual comparison, it silently passes it. `
          + 'Capture it again.',
        ko: `${name}: 0바이트다 — 빈 캡처는 시각 비교를 실패시키는 게 아니라 조용히 통과시킨다. 다시 찍어라.`,
      }));
      continue;
    }

    const ext = path.extname(name).slice(1).toLowerCase();
    const file: EvidenceFile = { name, path: abs, size: st.size, ext };
    /**
     * [QUAL-200] **시각 증거 게이트가 시각 산출물을 요구하지 않고 있었다.**
     *
     * 검사는 `.png` 에만 걸려 있었고, 그 밖의 확장자는 **무검증으로 `usable`** 이었다.
     * 실측: `echo 'not an image' > notes.txt` 한 줄로 `wave complete` 가 성공했다 —
     * 거부문은 「스크린샷을 두라」고 하고, `evidence check` 는 그 txt 를 `usable` 로 분류하고,
     * README 는 「그리지 않은 UX 는 출하할 수 없다」고 광고한다. **셋이 서로 다른 말을 했다.**
     *
     * 게이트를 여는 자격은 **제품이 이름 붙인 산출물**로 좁힌다 — 이미지와 HTML 내보내기
     * (Claude Design 흐름이 그 둘을 말한다). 나머지 파일은 있어도 되지만 **게이트를 열지는 않는다**.
     */
    if (!IMAGE_MIME[ext] && ext !== 'html' && ext !== 'htm') {
      unusable.add(name);
      problems.push(`${name}: ${t({
        en: 'is not a visual artifact — the UX gate opens on a screenshot (png/jpg/webp) or an exported '
          + 'HTML mockup. Other files may sit here, but they do not stand in for a capture.',
        ko: '시각 산출물이 아니다 — UX 게이트는 캡처(png·jpg·webp)나 내보낸 HTML 목업으로 열린다. '
          + '다른 파일이 함께 있어도 되지만 캡처를 대신하지는 못한다.',
      })}`);
    }
    if (ext === 'png') {
      const d = pngDimensions(abs);
      if (!d) {
        // 치명 — 이 파일은 **자기가 주장하는 것이 아니다**. 게이트를 열어서는 안 된다.
        unusable.add(name);
        problems.push(`${name}: ${t({
          en: 'cannot read the PNG header — it may be a corrupt file that is only named .png',
          ko: 'PNG 헤더를 읽을 수 없다 — 확장자만 png 인 손상 파일일 수 있다',
        })}`);
      } else {
        file.dimensions = d;
        // [QUAL-140] 크기와 치수 **둘 다** 본다. 크기는 패딩으로, 치수는 그리지 않고는 못 넘는다.
        // 그리고 여기서 걸리면 `usable` 에서 뺀다 — 보고만 하고 통과시키면 게이트가 아니다.
        if (st.size < MIN_PNG_BYTES || Math.min(d.width, d.height) < MIN_PNG_EDGE) {
          unusable.add(name);
          problems.push(t({
            en: `${name}: ${st.size} bytes (${d.width}x${d.height}) is too small — most likely a blank screen or `
              + `a failed capture. A real screen capture is at least ${MIN_PNG_EDGE}px on each side. `
              + 'Capture the running UI again.',
            ko: `${name}: ${st.size}바이트(${d.width}x${d.height})로 너무 작다 — `
              + `빈 화면이거나 실패한 캡처일 가능성이 높다. 실주행 캡처는 각 변이 최소 ${MIN_PNG_EDGE}px 다. `
              + '실행 중인 화면을 다시 찍어라.',
          }));
        }
      }
    }
    if (!EXPECTED_EXTS.has(ext)) {
      unusable.add(name);      // 증적 형식이 아니다 — 세지 않는다
      problems.push(t({
        en: `${name}: unexpected format for evidence (${ext ? `.${ext}` : 'no extension'}) — only screenshots, `
          + 'videos, traces and reports are treated as visual evidence.',
        ko: `${name}: 증적으로 예상되지 않는 형식(${ext ? `.${ext}` : '확장자 없음'}) — `
          + '스크린샷·비디오·트레이스·리포트만 시각 증적으로 다룬다.',
      }));
    }
    files.push(file);
  }

  const usable = files.filter(f => !unusable.has(f.name));
  return { ok: usable.length > 0, files, entries: names.length, usable, problems };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 출하 게이트 지지대 (P10/P12)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 실주행 캡처로 인정할 수 있는 파일인가 — 헤더가 읽히고, 빈 화면 의심 크기가 아니고,
 * **실제 화면 치수**인 PNG. [QUAL-140] 치수 조건이 없으면 1×1 에 패딩을 채워 통과한다.
 * `wave complete`(usable)와 여기(measured)가 같은 세 조건을 쓴다 —
 * 판정 기준이 표면마다 다르면 사람은 가장 약한 쪽을 믿는다.
 */
const isRealCapture = (f: EvidenceFile): boolean =>
  f.ext === 'png' && f.dimensions !== undefined && f.size >= MIN_PNG_BYTES
  && Math.min(f.dimensions.width, f.dimensions.height) >= MIN_PNG_EDGE;

/**
 * P10/P12 가 `measured` 를 주장할 수 있는가 — **E2E 실주행 증적 없이는 measured 불가**(§3-5).
 *
 * 기준을 2x 스크린샷 하나로 좁힌 이유: 로그·리포트 텍스트는 "돌렸다는 주장"이지 측정이 아니고,
 * 스펙이 의무화한 것도 스크린샷이다. 판정 기준이 여럿이면 가장 약한 것으로 수렴한다.
 */
export function hasMeasuredEvidence(root: string, waveId: string): boolean {
  return validateEvidence(root, waveId).files.some(isRealCapture);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. P9 비교 리뷰 패킷 — 자기완결 HTML, base64 임베드
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 파일을 base64 data: URI 로. 읽을 수 없거나 이미지 형식이 아니면 null(호출측이 시끄럽게 알린다). */
function dataUri(abs: string): string | null {
  const mime = IMAGE_MIME[path.extname(abs).slice(1).toLowerCase()];
  if (!mime) return null;
  try {
    const buf = fs.readFileSync(abs);
    if (buf.length === 0) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const PACKET_CSS = [
  ':root { color-scheme: light dark; }',
  'body {',
  '  margin: 0; padding: 1.5rem; background: Canvas; color: CanvasText;',
  '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5;',
  '}',
  'h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }',
  'h2 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }',
  '.sub { opacity: 0.75; font-size: 0.9rem; margin: 0 0 1rem; }',
  '.alert {',
  '  border: 3px solid #d93025; border-radius: 8px; padding: 0.75rem 1rem; margin: 0 0 1.25rem;',
  '}',
  '.alert h2 { color: #d93025; margin: 0 0 0.5rem; font-size: 1.1rem; }',
  '.alert ul { margin: 0; padding-left: 1.25rem; }',
  '.cmp { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }',
  'figure { margin: 0; border: 1px solid GrayText; border-radius: 8px; overflow: hidden; }',
  'figcaption {',
  '  padding: 0.5rem 0.75rem; border-bottom: 1px solid GrayText;',
  '  font-size: 0.9rem; font-weight: 600;',
  '}',
  'figure img { display: block; width: 100%; height: auto; }',
  '.missing {',
  '  display: flex; align-items: center; justify-content: center; min-height: 240px;',
  '  padding: 1rem; text-align: center; color: #d93025; font-weight: 600;',
  '}',
  'dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0; }',
  'dt { opacity: 0.75; }',
  'dd { margin: 0; }',
  'ul.criteria { margin: 0; padding-left: 1.25rem; }',
  'code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }',
];

/** 한쪽 액자 — 이미지가 없으면 `<img>` 를 아예 내지 않는다(빈 액자가 통과처럼 보이면 안 된다). */
const NOT_COMPARABLE: Msg = { en: 'not comparable', ko: '비교 불가' };
const ACCEPTANCE_HEADING: Msg = { en: 'Acceptance criteria', ko: '수용 기준' };

function figure(caption: string, uri: string | null, missingText: string, meta: string): string[] {
  return [
    '    <figure>',
    `      <figcaption>${esc(caption)}</figcaption>`,
    uri
      ? `      <img alt="${esc(caption)}" src="${uri}">`
      : `      <div class="missing">${esc(missingText)}</div>`,
    `      <figcaption style="border-bottom:none;border-top:1px solid GrayText;font-weight:400">${esc(meta)}</figcaption>`,
    '    </figure>',
  ];
}

/**
 * P9 비교 리뷰 패킷(§3-5): P4 기준 이미지(아트보드 2x) vs 웨이브 실주행 캡처를 나란히 놓고
 * 수용 기준을 붙인 **자기완결 HTML**. 외부 CSS·JS·이미지를 하나도 참조하지 않는다 — 이미지는
 * base64 `data:` URI 로 임베드한다(아티팩트 CSP 가 외부·상대 경로를 막는다).
 *
 * **한쪽이 없으면 시끄럽게 말한다.** 기준이나 구현 캡처가 빠진 채 반쪽만 렌더하면 사람 눈에는
 * "차이 없음 = 통과"처럼 보인다. 그래서 제목부터 `[비교 불가]` 를 달고 상단에 사유를 세운다.
 *
 * 순수·결정적이다(같은 입력 → 바이트 동일). 시각을 찍지 않는다.
 */
export function buildComparisonPacket(root: string, opts: ComparisonPacketOptions): string {
  const uxNodeId = requireUxId(opts?.uxNodeId);
  const waveId = requireWaveId(opts?.waveId);
  const lang = langFor(root);
  const t = trFor(lang);
  const blockers: string[] = [];

  // ── 기준 이미지 (P4 아트보드 2x)
  const baseline = getBaseline(root, uxNodeId);
  let baselineUri: string | null = null;
  let baselineMeta = '';
  if (!baseline) {
    blockers.push(t({
      en: `no baseline image is registered for ${uxNodeId} — export the P4 artboard at 2x and register it as `
        + 'the baseline before a P9 comparison means anything (spec §8).',
      ko: `${uxNodeId} 의 기준 이미지가 등록되지 않았다 — P4 아트보드를 2x 로 내보내 `
        + '기준 이미지로 등록해야 P9 비교가 성립한다(스펙 §8).',
    }));
  } else {
    const abs = path.isAbsolute(baseline.path) ? baseline.path : path.join(root, baseline.path);
    baselineUri = dataUri(abs);
    if (!baselineUri) {
      blockers.push(t({
        en: `cannot read the baseline image file: ${abs} — it is registered, but the file is gone or is not an image.`,
        ko: `기준 이미지 파일을 읽을 수 없다: ${abs} — 등록은 됐는데 파일이 사라졌거나 이미지가 아니다.`,
      }));
      baselineMeta = baseline.path;
    } else {
      const d = pngDimensions(abs);
      baselineMeta = `${baseline.path}${d ? ` · ${d.width}x${d.height}px` : ''} · ${t({
        en: `registered ${baseline.recordedAt}`,
        ko: `등록 ${baseline.recordedAt}`,
      })}`;
    }
  }

  // ── 구현 캡처 (웨이브 증적)
  const report = validateEvidence(root, waveId);
  const pngs = report.files.filter(f => f.ext === 'png');
  const wanted = opts.captureName ?? captureFileNameFor(uxNodeId);
  const capture = pngs.find(f => f.name === wanted) ?? pngs[0];
  let captureUri: string | null = null;
  let captureMeta = '';
  if (!capture) {
    blockers.push(t({
      en: `there is no implementation capture — ${evidenceDir(root, waveId)} holds no PNG screenshot at all. `
        + 'Leave a 2x screenshot from a headless real run (spec §3-5).',
      ko: `구현 캡처가 없다 — ${evidenceDir(root, waveId)} 에 PNG 스크린샷이 하나도 없다. `
        + 'headless 실주행으로 2x 스크린샷을 남겨라(스펙 §3-5).',
    }));
  } else {
    captureUri = dataUri(capture.path);
    if (!captureUri) {
      blockers.push(`${t({
        en: 'cannot read the implementation capture',
        ko: '구현 캡처를 읽을 수 없다',
      })}: ${capture.path}`);
    }
    const d = capture.dimensions;
    const dimPart = d
      ? ` · ${d.width}x${d.height}px`
      : ` · ${t({ en: 'header unreadable', ko: '헤더 판독 불가' })}`;
    captureMeta = `${capture.name}${dimPart} · ${t({
      en: `${capture.size} bytes`,
      ko: `${capture.size}바이트`,
    })}`;
    if (!isRealCapture(capture)) {
      blockers.push(t({
        en: `${capture.name} does not count as a real-run capture (${capture.size} bytes) — it may be a blank `
          + 'screen or a corrupt file.',
        ko: `${capture.name} 은 실주행 캡처로 인정되지 않는다(${capture.size}바이트) — `
          + '빈 화면이거나 손상된 파일일 수 있다.',
      }));
    }
  }

  // ── 수용 기준 · 원장
  const node = getNode(root, uxNodeId);
  let acceptance: string[] = [];
  let waveNote = '';
  try {
    acceptance = readWave(root, waveId).meta.acceptance;
  } catch {
    waveNote = t({
      en: `the instruction sheet of ${waveId} could not be read, so its acceptance criteria are missing`,
      ko: `${waveId} 지시서를 읽을 수 없어 수용 기준을 실을 수 없었다`,
    });
    blockers.push(`${waveNote} — ${t({
      en: 'a comparison with nothing to compare against is an impression.',
      ko: '무엇과 대조하는지 없이 하는 비교는 감상이다.',
    })}`);
  }

  const blocked = blockers.length > 0;
  const title = `${uxNodeId} ${t({ en: 'P9 comparison review packet', ko: 'P9 비교 리뷰 패킷' })}`;

  const out: string[] = [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${blocked ? `[${t(NOT_COMPARABLE)}] ` : ''}${esc(title)}</title>`,
    '<style>',
    ...PACKET_CSS,
    '</style>',
    '</head>',
    '<body>',
    `  <h1>${esc(title)}</h1>`,
    `  <p class="sub">${esc(node?.title ?? t({ en: '(node not in the ledger)', ko: '(원장에 없는 노드)' }))}`
    + ` · ${esc(t({ en: 'ledger', ko: '원장' }))} v${esc(node?.version ?? '?')}`
    + ` · ${esc(t({ en: 'wave', ko: '웨이브' }))} ${esc(waveId)}</p>`,
  ];

  if (blocked) {
    out.push(
      '  <section class="alert" role="alert">',
      `    <h2>${esc(t({
        en: 'Not comparable — do not pass P9 on this packet',
        ko: '비교 불가 — 이 패킷으로 P9 를 통과시키지 마라',
      }))}</h2>`,
      '    <ul>',
      ...blockers.map(b => `      <li>${esc(b)}</li>`),
      '    </ul>',
      '  </section>',
    );
  }

  out.push(
    `  <h2>${esc(t({ en: 'Baseline vs implementation', ko: '기준 vs 구현' }))}</h2>`,
    '  <div class="cmp">',
    ...figure(
      t({ en: 'Baseline — P4 artboard (2x)', ko: '기준 — P4 아트보드 (2x)' }),
      baselineUri,
      t({ en: 'no baseline image — there is nothing to compare against', ko: '기준 이미지 없음 — 비교할 대상이 없다' }),
      baselineMeta,
    ),
    ...figure(
      t({ en: `Implementation — real-run capture of ${waveId}`, ko: `구현 — ${waveId} 실주행 캡처` }),
      captureUri,
      t({ en: 'no implementation capture — there is no real-run evidence', ko: '구현 캡처 없음 — 실주행 증적이 없다' }),
      captureMeta,
    ),
    '  </div>',
    `  <h2>${esc(t(ACCEPTANCE_HEADING))}</h2>`,
  );

  if (acceptance.length > 0) {
    out.push('  <ul class="criteria">', ...acceptance.map(a => `    <li>${esc(a)}</li>`), '  </ul>');
  } else {
    out.push(`  <p class="missing">${esc(waveNote || t({
      en: `${waveId} has no acceptance criteria — with nothing to check against, no pass verdict is possible`,
      ko: `${waveId} 에 수용 기준이 없다 — 대조 기준 없이는 통과 판정을 할 수 없다`,
    }))}</p>`);
  }

  if (report.problems.length > 0) {
    out.push(
      `  <h2>${esc(t({ en: 'Evidence directory findings', ko: '증적 디렉토리 소견' }))}</h2>`,
      '  <ul>',
      ...report.problems.map(p => `    <li>${esc(p)}</li>`),
      '  </ul>',
    );
  }

  out.push(
    `  <h2>${esc(t({ en: 'Provenance', ko: '출처' }))}</h2>`,
    '  <dl>',
    `    <dt>${esc(t({ en: 'UX node', ko: 'UX 노드' }))}</dt><dd><code>${esc(uxNodeId)}</code></dd>`,
    `    <dt>${esc(t({ en: 'Scenario', ko: '시나리오' }))}</dt><dd><code>${esc(specFileNameFor(uxNodeId))}</code></dd>`,
    `    <dt>${esc(t({ en: 'Evidence directory', ko: '증적 디렉토리' }))}</dt>`
    + `<dd><code>${esc(evidenceDir(root, waveId))}</code></dd>`,
    `    <dt>${esc(t({ en: 'Evidence grade', ko: '측정 근거' }))}</dt><dd>${esc(hasMeasuredEvidence(root, waveId)
      ? t({ en: 'real-run capture present (measured is claimable)', ko: '실주행 캡처 있음 (measured 주장 가능)' })
      : t({ en: 'no real-run capture — measured is not available (spec §3-5)', ko: '실주행 캡처 없음 — measured 불가 (스펙 §3-5)' }))}</dd>`,
    '  </dl>',
    '</body>',
    '</html>',
    '',
  );

  return out.join('\n');
}
