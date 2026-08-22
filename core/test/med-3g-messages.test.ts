/**
 * 라운드 3-G MED — 메시지 계열 3건. 공통 뿌리는 이 리포가 반복해서 무는 하나다:
 * **메시지가 사실과 다르거나, 가리키는 곳에 답이 없다.**
 *
 * [UX-116] 리뷰 패킷이 "빈 패킷으로는 게이트를 열 수 없다"고 단언했는데 실제로는 열렸다.
 *   리뷰어가 「어차피 시스템이 거부한다」고 믿게 만드는 문구는, 그 믿음이 틀렸을 때
 *   승인 한 번을 그냥 통과시킨다.
 * [UX-117] `state.json` 이 깨지면 `status` 가 원시 파스 오류만 뱉었다 — 혼란 시 가장 먼저
 *   치는 명령이 나가는 길을 안 알려 줬다.
 * [UX-118] `profile cmd` 가 파스 오류를 삼키고 「없다 — 채워라」는 순환 처방을 냈다.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';

const capture = (fn: () => number): { code: number; text: string } => {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  try { return { code: fn(), text: out.join('\n') }; } finally { l.mockRestore(); e.mockRestore(); }
};

const init = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-msg-'));
  capture(() => run(['init'], root));
  return root;
};

describe('[UX-116] 리뷰 패킷은 없는 강제를 단언하지 않는다', () => {
  it('산출물 미등록 패킷이 「열 수 없다」고 하지 않고, 실재하는 처방을 준다', () => {
    const root = init();
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/concept.md'), 'x'.repeat(400));
    const { text } = capture(() => run(['report', 'packet', 'P0'], root));
    const packetPath = path.join(root, '.harness/packets/P0.md');
    const body = text + (fs.existsSync(packetPath) ? fs.readFileSync(packetPath, 'utf8') : '');
    expect(body, '패킷이 비어 있다').not.toBe('');

    // 사실이 아닌 단언이 없다.
    expect(body).not.toMatch(/cannot open a gate|게이트를 열 수 없다/);
    // 처방에 실재하는 명령이 있다.
    expect(body).toMatch(/harness doc upsert/);
  });
});

describe('[UX-117] 손상된 상태 파일에도 나가는 길이 있다', () => {
  const broken = (): string => {
    const root = init();
    fs.writeFileSync(path.join(root, '.harness/state.json'), 'garbage{');
    return root;
  };

  it('status 가 원인만 던지지 않고 복구 명령을 준다', () => {
    const root = broken();
    const { code, text } = capture(() => run(['status'], root));
    expect(code).toBe(1);
    expect(text).toMatch(/doctor --repair/);
  });

  it('그 안내가 실제로 복구한다 — 가리키는 곳에 답이 있다', () => {
    const root = broken();
    expect(capture(() => run(['doctor', '--repair'], root)).code).toBe(0);
    expect(capture(() => run(['status'], root)).code).toBe(0);
  });

  it('과차단 짝 — 성한 상태에서는 아무 문구도 늘지 않는다', () => {
    const root = init();
    const { code, text } = capture(() => run(['status'], root));
    expect(code).toBe(0);
    expect(text).not.toMatch(/doctor --repair/);
  });
});

describe('[UX-118] profile cmd 는 파스 오류를 삼키지 않는다', () => {
  it('commands.yaml 이 깨져 있으면 그 사실과 파일 경로를 말한다', () => {
    const root = init();
    const dir = path.join(root, '.harness/profile');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'commands.yaml'), 'build: a\nbuild: b\n');   // 중복 키
    const { code, text } = capture(() => run(['profile', 'cmd', 'build'], root));
    expect(code).toBe(1);
    expect(text).toContain('commands.yaml');
    // 방금 채운 사람에게 「채워라」만 하고 끝내지 않는다 — 무엇이 잘못됐는지 말한다.
    expect(text.length).toBeGreaterThan(40);
  });

  it('과차단 짝 — 정상 프로파일에서는 명령을 그대로 돌려준다', () => {
    const root = init();
    const dir = path.join(root, '.harness/profile');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'commands.yaml'), 'test: npm test\n');
    const { code, text } = capture(() => run(['profile', 'cmd', 'test'], root));
    expect(code).toBe(0);
    expect(text).toContain('npm test');
  });
});
