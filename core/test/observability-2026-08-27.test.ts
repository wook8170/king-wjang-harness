/**
 * 관측성 회귀 테스트 — 출하 검증 `docs/release-readiness/2026-08-27/` 의 차단 결함
 * [OPS-01]·[OPS-02] 를 **재현하는 테스트**다.
 *
 * 두 결함의 뿌리는 하나였다: **열화 신호가 한 경로(state.json 파손)에만 배선돼 있었다.**
 * 그 경로를 타지 않는 두 사고 — 저널만 손상 · 번들 부재 — 는 배너·deny 사유·`doctor` 를
 * 전부 우회했고, 사용자는 **보호받고 있다고 믿으면서 보호받지 못했다.**
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initHarness } from '../src/state';
import { handleHook } from '../src/hook';

const REPO = path.resolve(__dirname, '../..');

const setup = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-obs-'));
  initHarness(root);
  return root;
};

const journal = (root: string): string => path.join(root, '.harness', 'events.jsonl');

const sessionStart = (root: string): string => {
  const out = handleHook(root, 'session-start', { source: 'startup' }) as any;
  return out?.hookSpecificOutput?.additionalContext ?? '';
};

describe('[OPS-01] 저널 손상은 state 가 멀쩡해도 사용자에게 보인다', () => {
  it('정상 상태에서는 열화 경고가 없다 — 대조군', () => {
    const root = setup();
    const ctx = sessionStart(root);
    expect(ctx).not.toMatch(/corrupt|손상/);
  });

  it('state 는 그대로 두고 저널만 깨뜨리면 세션 시작 배너가 말한다', () => {
    const root = setup();
    const before = fs.readFileSync(path.join(root, '.harness', 'state.json'), 'utf8');
    fs.appendFileSync(journal(root), '{ this is not valid json\n');

    const ctx = sessionStart(root);
    expect(ctx).toMatch(/corrupt|손상/);
    expect(ctx).toMatch(/1/);                                  // 손상 줄 수를 말한다

    // state.json 은 건드리지 않았다 — 「재생으로 돌고 있다」가 아니라 「이력을 못 믿는다」여야 한다.
    expect(fs.readFileSync(path.join(root, '.harness', 'state.json'), 'utf8')).toBe(before);
    expect(ctx).not.toMatch(/running from journal replay|재생으로 동작/);
  });

  it('손상 줄이 여러 개면 그 수를 말한다', () => {
    const root = setup();
    fs.appendFileSync(journal(root), 'garbage one\ngarbage two\ngarbage three\n');
    expect(sessionStart(root)).toMatch(/3/);
  });

  it('state 파손과 저널 손상이 겹치면 재생 문구를 쓴다 — 두 이야기를 섞지 않는다', () => {
    const root = setup();
    fs.appendFileSync(journal(root), 'garbage\n');
    fs.writeFileSync(path.join(root, '.harness', 'state.json'), '{ broken');
    const ctx = sessionStart(root);
    expect(ctx).toMatch(/running from journal replay|재생으로 동작/);
    expect(ctx).toMatch(/corrupt|손상/);
  });
});

describe('[OPS-02] 번들이 없으면 강제가 꺼진 사실이 흔적으로 남는다', () => {
  /**
   * `core/dist` 가 없으면 훅 경로는 무해 계약대로 조용히 exit 0 한다 — **그건 옳다.**
   * 결함은 그 사실이 **어디에도 안 남는 것**이었다: stderr 는 exit 0 이면 안 보이고,
   * `hook-errors.log` 는 require 실패 뒤라 기록되지 않았으며, `doctor` 는 `ok: true` 였다.
   */
  const brokenInstall = (): string => {
    const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-nodist-'));
    fs.mkdirSync(path.join(plugin, 'bin'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'bin/harness'), path.join(plugin, 'bin/harness'));
    fs.chmodSync(path.join(plugin, 'bin/harness'), 0o755);
    // core/dist 를 **일부러 만들지 않는다** — 부분 클론·실패한 업데이트를 흉내 낸다.
    return plugin;
  };

  const runBroken = (plugin: string, root: string, args: string[]): { code: number } => {
    try {
      execFileSync(process.execPath, [path.join(plugin, 'bin/harness'), ...args], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        stdio: 'pipe',
        input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' } }),
      });
      return { code: 0 };
    } catch (e: any) {
      return { code: e.status ?? -1 };
    }
  };

  it('훅 경로는 여전히 exit 0 이다 — 무해 계약은 그대로다', () => {
    const root = setup();
    expect(runBroken(brokenInstall(), root, ['hook', 'pre-tool']).code).toBe(0);
  });

  it('그러나 hook-errors.log 에 흔적이 남는다 — doctor 가 이미 이 로그를 센다', () => {
    const root = setup();
    const log = path.join(root, '.harness', '.runtime', 'hook-errors.log');
    expect(fs.existsSync(log)).toBe(false);                    // 대조군

    runBroken(brokenInstall(), root, ['hook', 'pre-tool']);

    expect(fs.existsSync(log)).toBe(true);
    const body = fs.readFileSync(log, 'utf8');
    expect(body).toMatch(/no-bundle/);
    expect(body).toMatch(/enforcement-off/);
  });

  it('CLI 경로는 계약대로 exit 1 로 요란하다', () => {
    const root = setup();
    expect(runBroken(brokenInstall(), root, ['status']).code).toBe(1);
  });

  it('하네스를 안 쓰는 프로젝트에는 아무것도 안 쓴다 — 비간섭 불변식', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-plain-'));
    runBroken(brokenInstall(), plain, ['hook', 'pre-tool']);
    expect(fs.existsSync(path.join(plain, '.harness'))).toBe(false);
  });
});
