import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import {
  tierFor,
  isCacheFresh,
  readUsageCache,
  writeUsageCache,
  shouldInject,
  guidanceFor,
  recordTier,
  lastTier,
  USAGE_CACHE_TTL_MS,
} from '../src/usage';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('tierFor', () => {
  it('경계 바로 아래는 승급하지 않는다', () => {
    expect(tierFor(0)).toBe('normal');
    expect(tierFor(89.9)).toBe('normal');
    expect(tierFor(94.9)).toBe('reduce');
    expect(tierFor(98.9)).toBe('settle-every-turn');
  });

  it('경계값 자체는 승급한다 (90/95/99)', () => {
    expect(tierFor(90)).toBe('reduce');
    expect(tierFor(95)).toBe('settle-every-turn');
    expect(tierFor(99)).toBe('final-handoff');
  });

  it('100 초과도 최고 티어로 고정 (예산 보정 오차 대비)', () => {
    expect(tierFor(150)).toBe('final-handoff');
  });

  it('숫자가 아니거나 음수면 normal (훅은 죽지 않는다)', () => {
    expect(tierFor(-1)).toBe('normal');
    expect(tierFor(Number.NaN)).toBe('normal');
    expect(tierFor(Number.POSITIVE_INFINITY)).toBe('final-handoff');
  });
});

describe('usage 캐시', () => {
  it('TTL 기본값은 원본 token-guard 의 180초', () => {
    expect(USAGE_CACHE_TTL_MS).toBe(180_000);
  });

  it('179초는 신선, 181초는 만료 (now 주입)', () => {
    const cache = { percent: 42, fetchedAt: 1_000_000 };
    expect(isCacheFresh(cache, 1_000_000 + 179_000)).toBe(true);
    expect(isCacheFresh(cache, 1_000_000 + 181_000)).toBe(false);
  });

  it('TTL 을 명시로 덮어쓸 수 있다', () => {
    const cache = { percent: 42, fetchedAt: 1_000_000 };
    expect(isCacheFresh(cache, 1_000_000 + 5_000, 10_000)).toBe(true);
    expect(isCacheFresh(cache, 1_000_000 + 15_000, 10_000)).toBe(false);
  });

  it('미래 타임스탬프(시계 역행)는 만료로 취급', () => {
    expect(isCacheFresh({ percent: 42, fetchedAt: 2_000_000 }, 1_000_000)).toBe(false);
  });

  it('undefined 캐시는 항상 만료', () => {
    expect(isCacheFresh(undefined, 1_000_000)).toBe(false);
  });

  it('write 후 read 왕복', () => {
    const root = setup();
    expect(readUsageCache(root)).toBeUndefined();
    writeUsageCache(root, { percent: 93.5, fetchedAt: 1_700_000_000_000 });
    expect(readUsageCache(root)).toEqual({ percent: 93.5, fetchedAt: 1_700_000_000_000 });
  });

  it('깨진 캐시 파일은 undefined (훅은 죽지 않는다)', () => {
    const root = setup();
    writeUsageCache(root, { percent: 10, fetchedAt: 1 });
    fs.writeFileSync(path.join(root, '.harness/.runtime/usage.json'), '{{{');
    expect(readUsageCache(root)).toBeUndefined();
  });
});

describe('shouldInject', () => {
  it('티어 상승 시에만 주입', () => {
    expect(shouldInject('normal', 'reduce')).toBe(true);
    expect(shouldInject('reduce', 'final-handoff')).toBe(true);
    expect(shouldInject('settle-every-turn', 'final-handoff')).toBe(true);
  });

  it('같은 티어는 주입하지 않는다 (매 턴 반복 = 무시되는 노이즈)', () => {
    expect(shouldInject('reduce', 'reduce')).toBe(false);
    expect(shouldInject('normal', 'normal')).toBe(false);
    expect(shouldInject('final-handoff', 'final-handoff')).toBe(false);
  });

  it('티어 하강(리셋)은 주입하지 않는다', () => {
    expect(shouldInject('final-handoff', 'normal')).toBe(false);
    expect(shouldInject('settle-every-turn', 'reduce')).toBe(false);
  });
});

describe('guidanceFor', () => {
  it('티어마다 서로 다른 비어있지 않은 지침', () => {
    // 화살표로 감싼다 — `.map(guidanceFor)` 는 index 를 두 번째 인자(lang)로 흘린다.
    const texts = (['normal', 'reduce', 'settle-every-turn', 'final-handoff'] as const)
      .map(t => guidanceFor(t));
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(4);
  });

  it('최고 티어 지침은 핸드오프와 소환을 모두 지시 (양 언어)', () => {
    // guidanceFor 는 순수라 env 를 보지 않는다 — 언어를 명시적으로 넘긴다(기본값은 en).
    const ko = guidanceFor('final-handoff', 'ko');
    expect(ko).toContain('핸드오프');
    expect(ko).toContain('소환');
    const en = guidanceFor('final-handoff');
    expect(en).toContain('handoff');
    expect(en).toContain('summon');
    expect(en).not.toMatch(/[가-힣]/); // 기본 출력에 한국어가 섞이지 않는다
  });
});

describe('recordTier / lastTier', () => {
  it('기록 전에는 normal', () => {
    expect(lastTier(setup())).toBe('normal');
  });

  it('기록 후 왕복 — 훅 호출 사이에 상승 판정이 살아남는다', () => {
    const root = setup();
    recordTier(root, 'settle-every-turn');
    expect(lastTier(root)).toBe('settle-every-turn');
    recordTier(root, 'final-handoff');
    expect(lastTier(root)).toBe('final-handoff');
  });

  it('하강도 기록된다 (리셋 후 재상승을 다시 잡기 위해)', () => {
    const root = setup();
    recordTier(root, 'final-handoff');
    recordTier(root, 'normal');
    expect(lastTier(root)).toBe('normal');
  });

  it('알 수 없는 값이 적혀 있으면 normal 로 취급', () => {
    const root = setup();
    recordTier(root, 'reduce');
    fs.writeFileSync(path.join(root, '.harness/.runtime/usage-tier'), 'garbage');
    expect(lastTier(root)).toBe('normal');
  });
});
