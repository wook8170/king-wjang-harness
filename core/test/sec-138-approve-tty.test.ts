/**
 * [SEC-138] **`gate approve` 의 잠금이 한 겹뿐이라 사소한 난독화로 열렸다.**
 *
 * [SEC-103] 이 훅 백스톱을 만든 이유는 「allowlist·bypassPermissions 환경에는 승인
 * 다이얼로그가 없어 방어가 0」이었다. 그런데 **바로 그 환경에서 그 한 겹이 뚫렸다** —
 * 라운드 3-I 실효성 감정자가 세 형태로 실측 개통했다:
 *   `node -e "require('…/'+'cli.js')…"` (문자열 결합) · `harness gate 'appr''ove' P0`
 *   (따옴표 분리) · `bin/hh gate approve P0` (리네임).
 *
 * 같은 파일의 `--force`·`--accept-policy` 는 **훅 + CLI env 두 겹**이라 같은 난독화를
 * 버틴다. **이 비대칭이 결함이었다** — 훅의 형태 인식은 언제나 빠진 형태를 남기므로
 * (SEC-100·SEC-135 와 같은 교훈), 형태를 인식하지 않는 두 번째 겹이 있어야 한다.
 *
 * 두 번째 겹은 env 가 아니라 **TTY** 다. `gate approve` 는 탈출구가 아니라 정상 흐름이라
 * 사람에게 env 를 요구하면 문서·패킷·도움말이 가리키는 길이 통째로 어긋난다. 사람은
 * 자기 터미널에 있으니 TTY 가 있고, 에이전트의 도구 호출에는 없다 — **사람에게는 비용이
 * 0 이고 에이전트는 형태를 아무리 바꿔도 TTY 를 만들 수 없다.**
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import type { Phase } from '../src/types';

const ENV = 'HARNESS_APPROVE_NO_TTY';

/** P0 게이트를 승인 직전까지(제출 완료) 몰아 둔 샌드박스. */
function submitted(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-sec138-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase: 'P0' as Phase });
  const art = path.join(root, 'concept.md');
  fs.writeFileSync(art, `# 개념\n${'실측한 내용을 적는다. '.repeat(12)}\n`);
  run(['gate', 'submit', 'P0', '--evidence', 'measured', '--paths', 'concept.md'], root);
  return root;
}

const approved = (root: string): boolean => readState(root).gates?.P0?.status === 'approved';

/** `run` 은 던지지 않고 stderr 에 적고 exit 1 을 돌려준다 — 그 둘을 함께 본다. */
function approve(root: string): { code: number; err: string } {
  const orig = console.error;
  let err = '';
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  try { return { code: run(['gate', 'approve', 'P0'], root), err }; }
  finally { console.error = orig; }
}

const bash = (root: string, command: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';

afterEach(() => { delete process.env[ENV]; });

describe('[SEC-138] 승인 잠금은 두 겹이다 — 훅(형태) + CLI(TTY)', () => {
  it('TTY 가 없으면 CLI 가 거부한다 — 게이트는 제출 상태 그대로다', () => {
    const root = submitted();
    // vitest 는 stdin 이 TTY 가 아니다 — 에이전트의 도구 호출과 같은 조건이다.
    expect(process.stdin.isTTY).toBeFalsy();
    const r = approve(root);
    expect(r.code, '거부되지 않았다').toBe(1);
    expect(r.err).toMatch(/terminal|TTY/i);
    expect(approved(root), '거부됐는데 승인이 됐다').toBe(false);
  });

  it('거부문이 사람이 무엇을 하면 되는지 말한다 — 막다른 골목을 만들지 않는다', () => {
    const root = submitted();
    const msg = approve(root).err;
    expect(msg).toMatch(/harness gate approve/);        // 사람이 칠 명령 그대로
    expect(msg).toMatch(new RegExp(ENV));               // TTY 없는 사람 환경의 탈출구
  });

  it('훅이 형태를 놓쳐도 CLI 가 잡는다 — 감정자가 개통한 난독화 3형태', () => {
    // 이 형태들이 훅을 통과하는지 여부와 무관하게 승인은 일어나지 않아야 한다.
    // 훅은 형태를 세므로 언제나 빠진 형태가 있다(SEC-100·SEC-135). CLI 의 TTY 겹은
    // 형태를 세지 않으므로 **아직 이름 붙지 않은 형태에도 선다.**
    const root = submitted();
    for (const form of [
      `node -e "require('${root}/' + 'cli.js')"`,
      `harness gate 'appr''ove' P0`,
      `bin/hh gate approve P0`,
    ]) {
      bash(root, form);                                  // 훅 판정은 여기서 무엇이든 될 수 있다
    }
    expect(approve(root).code, '두 번째 겹이 서지 않았다').toBe(1);
    expect(approved(root)).toBe(false);
  });

  it('사람이 터미널에서 하는 정상 경로는 그대로 통과한다 — 비용 0', () => {
    const root = submitted();
    process.env[ENV] = '1';                              // TTY 대역(테스트는 TTY 를 못 만든다)
    expect(approve(root).code, '사람 경로가 막혔다 — 과차단이다').toBe(0);
    expect(approved(root)).toBe(true);
  });

  it('훅이 탈출구 env 리터럴 언급을 막는다 — 두 번째 겹이 인라인으로 꺼지지 않게', () => {
    const root = submitted();
    expect(denied(bash(root, `${ENV}=1 harness gate approve P0`))).toBe(true);
    // 이름을 바꿔 불러도 리터럴 절이 잡는다 — `--force` 와 같은 두 절 구조다.
    expect(denied(bash(root, `${ENV}=1 bin/hh gate approve P0`))).toBe(true);
  });

  it('승인 외의 게이트 명령은 계속 열려 있다 — 과차단 방지', () => {
    const root = submitted();
    for (const cmd of ['harness gate status', 'harness gate verify P0', 'harness gate submit P0']) {
      expect(denied(bash(root, cmd)), `${cmd} 가 막혔다`).toBe(false);
    }
  });
});
