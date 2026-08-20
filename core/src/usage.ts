/**
 * 사용량 티어 모듈 — 자작 도구 `token-guard` 이식 (스펙 §10, §4-1).
 *
 * **원본에서 그대로 가져온 것(재설계 금지 대상)**:
 *  - 티어 경계 90/95/99 와 각 티어의 행동(90=웨이브 축소, 95=매 턴 지시서 갱신 강제,
 *    99=최종 핸드오프 + 소환).
 *  - 180초 캐시 TTL. 원본 DESIGN.md 의 실측 경고 — 데이터원이 짧은 버스트에 rate limit 을
 *    수 분간 뱉는다 — 때문에 **이 값을 줄이지 말 것**.
 *  - **티어가 상승할 때만 주입**. 같은 티어를 매 턴 다시 밀어넣으면 노이즈가 되어 모델이
 *    통째로 무시하기 시작한다. 하강(리셋)은 조용히 기록만 한다.
 *
 * **의도적으로 이 모듈 밖에 남긴 것(스코프 밖)**:
 *  - 사용량 수치를 **가져오는 일**(usage API·로컬 트랜스크립트 집계). 코어는 네트워크를 타지
 *    않고 프로젝트 루트 밖을 읽지 않는다(§1). 수집기는 CLI·에이전트 계층 몫이고, 이 모듈은
 *    "퍼센트를 받아 티어로 환산하고 캐시·상승을 판정하는" 순수 반쪽만 담당한다.
 *  - macOS 알림(osascript) 발송, launchd 잡, 사용자 `~/.claude/` 변경.
 *
 * **시각은 전부 주입받는다** — 이 파일에 `Date.now()` 는 없다. 캐시 신선도 판정이 호출 시각에
 * 의존하면 훅 판정이 비결정적이 되고 테스트가 시계에 매달린다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtimeDir } from './paths';

/** 원본 token-guard 의 캐시 TTL. 줄이지 말 것(모듈 주석 참조). */
export const USAGE_CACHE_TTL_MS = 180_000;

export type UsageTier = 'normal' | 'reduce' | 'settle-every-turn' | 'final-handoff';

/** 낮은 티어부터. 상승 판정은 이 배열의 인덱스 비교다. */
const TIER_ORDER: readonly UsageTier[] = ['normal', 'reduce', 'settle-every-turn', 'final-handoff'];

const cacheFile = (root: string) => path.join(runtimeDir(root), 'usage.json');
const tierFile = (root: string) => path.join(runtimeDir(root), 'usage-tier');

/** 캐시된 사용량. `fetchedAt` 은 epoch 밀리초(주입된 값 그대로 저장한다). */
export interface UsageCache {
  percent: number;
  fetchedAt: number;
}

/**
 * 퍼센트 → 티어. 경계값 자체가 승급이다(90 → reduce). 100 초과도 최고 티어로 고정한다 —
 * 퍼센트는 예산 보정 기반 추정치라 100 을 넘길 수 있다.
 * 숫자가 아니면 normal: 훅은 판정 불가로 죽거나 사용자를 막지 않는다.
 */
export function tierFor(percent: number): UsageTier {
  if (typeof percent !== 'number' || Number.isNaN(percent)) return 'normal';
  if (percent >= 99) return 'final-handoff';
  if (percent >= 95) return 'settle-every-turn';
  if (percent >= 90) return 'reduce';
  return 'normal';
}

/**
 * 캐시 신선도. `nowMs` 는 반드시 호출자가 넣는다.
 * 미래 타임스탬프(시계 역행·다른 기기 파일)는 만료로 취급 — 무한히 신선한 캐시를 붙들고
 * 갱신을 영영 건너뛰는 것보다 한 번 더 재수집하는 쪽이 안전하다.
 */
export function isCacheFresh(
  cache: UsageCache | undefined,
  nowMs: number,
  ttlMs: number = USAGE_CACHE_TTL_MS,
): boolean {
  if (!cache) return false;
  const age = nowMs - cache.fetchedAt;
  return age >= 0 && age < ttlMs;
}

/** 캐시 읽기. 없거나 깨졌으면 undefined — 훅은 절대 죽으면 안 된다. */
export function readUsageCache(root: string): UsageCache | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(root), 'utf8')) as Partial<UsageCache>;
    if (typeof raw.percent !== 'number' || typeof raw.fetchedAt !== 'number') return undefined;
    return { percent: raw.percent, fetchedAt: raw.fetchedAt };
  } catch {
    return undefined;
  }
}

export function writeUsageCache(root: string, cache: UsageCache): void {
  fs.mkdirSync(runtimeDir(root), { recursive: true });
  fs.writeFileSync(cacheFile(root), JSON.stringify(cache) + '\n');
}

/**
 * 지침을 주입할지. **상승할 때만 true** — 원본에서 가장 값비싸게 얻은 규칙이다.
 * 같은 티어 반복 주입은 무시되는 잡음이 되고, 하강 주입은 경보를 희석한다.
 */
export function shouldInject(prevTier: UsageTier, nextTier: UsageTier): boolean {
  return TIER_ORDER.indexOf(nextTier) > TIER_ORDER.indexOf(prevTier);
}

/** 티어별 주입 문구. 짧은 명령형 — 긴 설명은 읽히지 않는다. */
export function guidanceFor(tier: UsageTier): string {
  switch (tier) {
    case 'reduce':
      return '[harness] 사용량 90% 도달 — 웨이브를 더 짧게 쪼개라. 각 웨이브 종료 시점이 커밋 가능한 안정 상태여야 한다.';
    case 'settle-every-turn':
      return '[harness] 사용량 95% 도달 — 매 턴 종료마다 지시서(핸드오프)를 갱신하라. 정산 스로틀은 해제됐다.';
    case 'final-handoff':
      return '[harness] 사용량 99% — 임계. 지금 작업을 안전한 지점에서 멈추고 최종 핸드오프를 완료한 뒤 사용자를 소환하라. 새 작업을 시작하지 마라.';
    case 'normal':
    default:
      return '[harness] 사용량 여유 — 평상 운영.';
  }
}

/** 마지막으로 주입한 티어를 남긴다. 훅 호출은 매번 새 프로세스라 상승 판정이 파일로 살아남아야 한다. */
export function recordTier(root: string, tier: UsageTier): void {
  fs.mkdirSync(runtimeDir(root), { recursive: true });
  fs.writeFileSync(tierFile(root), tier + '\n');
}

/** 기록이 없거나 알 수 없는 값이면 normal — 그래야 다음 상승이 반드시 한 번 주입된다. */
export function lastTier(root: string): UsageTier {
  try {
    const v = fs.readFileSync(tierFile(root), 'utf8').trim() as UsageTier;
    return TIER_ORDER.includes(v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}
