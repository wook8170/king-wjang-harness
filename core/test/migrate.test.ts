import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { detectLegacyTools, migrationReport, legacyHarnessGitignore } from '../src/migrate';

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-home-'));

const mk = (home: string, rel: string) => {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (rel.endsWith('/')) fs.mkdirSync(p, { recursive: true });
  else fs.writeFileSync(p, '');
  return p;
};

describe('detectLegacyTools', () => {
  it('빈 홈이면 아무것도 찾지 않는다', () => {
    expect(detectLegacyTools(tmpHome())).toEqual([]);
  });

  it('handoff-guard 디렉토리를 찾고 조치를 제시한다', () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.claude/handoff-guard/bin'), { recursive: true });
    const found = detectLegacyTools(home);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('handoff-guard');
    expect(found[0].kind).toBe('hook');
    expect(found[0].path).toBe(path.join(home, '.claude/handoff-guard'));
    expect(found[0].action.trim().length).toBeGreaterThan(0);
  });

  it('token-guard·auto-retry·terse-mode 훅도 각각 찾는다', () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.claude/token-guard'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude/auto-retry'), { recursive: true });
    mk(home, '.claude/hooks/terse-mode.sh');
    const names = detectLegacyTools(home).map((t) => t.name);
    expect(names).toEqual(['token-guard', 'auto-retry', 'terse-mode']);
    const autoRetry = detectLegacyTools(home).find((t) => t.name === 'auto-retry');
    expect(autoRetry?.kind).toBe('job');
  });

  it('같은 이름의 파일(디렉토리 아님)은 도구로 치지 않는다', () => {
    const home = tmpHome();
    mk(home, '.claude/token-guard');
    expect(detectLegacyTools(home)).toEqual([]);
  });

  it('os.homedir() 가 아니라 인자만 본다', () => {
    expect(detectLegacyTools(tmpHome())).toEqual([]);
  });
});

describe('migrationReport', () => {
  it('발견된 도구 이름과 해제 안내를 담는다', () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.claude/handoff-guard'), { recursive: true });
    const report = migrationReport(detectLegacyTools(home));
    expect(report).toContain('handoff-guard');
    expect(report).toContain(path.join(home, '.claude/handoff-guard'));
    expect(report).toContain('settings.json');
  });

  it('변경했다고 주장하지 않는다 — 안내 전용', () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.claude/handoff-guard'), { recursive: true });
    const ko = migrationReport(detectLegacyTools(home, 'ko'), 'ko');
    expect(ko).toContain('안내');
    expect(ko).not.toMatch(/해제했|삭제했|수정했|변경했|제거했/);
    // 기본(en)도 같은 계약이어야 한다 — 안내일 뿐 아무것도 바꾸지 않았다고 말한다.
    const en = migrationReport(detectLegacyTools(home));
    expect(en).toMatch(/advice only/);
    expect(en).not.toMatch(/[가-힣]/);
    expect(en).not.toMatch(/\b(removed|deleted|edited|changed)\b/i);
  });

  it('발견이 없으면 없다고 말한다', () => {
    const report = migrationReport([]);
    expect(report.trim().length).toBeGreaterThan(0);
    expect(report).not.toMatch(/해제했|삭제했|수정했|변경했|제거했/);
  });
});

describe('legacyHarnessGitignore', () => {
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
    initHarness(root);
    return root;
  };
  const gi = (root: string) => path.join(root, '.harness/.runtime/.gitignore');

  it('현재 형식(`*` + `!.gitignore`)은 false', () => {
    expect(legacyHarnessGitignore(setup())).toBe(false);
  });

  it('구 형식(`*` 만)은 true', () => {
    const root = setup();
    fs.writeFileSync(gi(root), '*\n');
    expect(legacyHarnessGitignore(root)).toBe(true);
  });

  it('공백·개행 없는 구 형식도 true', () => {
    const root = setup();
    fs.writeFileSync(gi(root), '  *  ');
    expect(legacyHarnessGitignore(root)).toBe(true);
  });

  it('파일이 없으면 false (init 전 프로젝트에 잡음 금지)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
    expect(legacyHarnessGitignore(root)).toBe(false);
  });
});
