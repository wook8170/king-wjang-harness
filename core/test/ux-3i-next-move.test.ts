/**
 * 라운드 3-I 사용성 LOW — **「무슨 일이 났는지」와 「다음에 뭘 하는지」를 말하지 않던 것들.**
 *
 * [UX-120] 성공 출력이 bare id 뿐이라 생성인지 갱신인지 모른다.
 * [UX-124] `doc submit` 거부문에 **칠 수 있는 명령**이 없었다(한쪽은 내부 함수명을 노출).
 * [UX-162] `design sync --from <없는 파일>` 이 가공 없는 원시 `ENOENT` 를 냈다.
 * [UX-163] doctor 경고가 「원인을 확인하라」면서 **어디를 볼지** 안 알려 줬다.
 *
 * 넷 다 같은 실패다: **사람이 멈춰 서는 지점에서 다음 한 걸음을 안 준다.** 이 제품의 거부는
 * 대부분 풍부한데, 비어 있는 몇 곳이 「어떤 건 알려 주고 어떤 건 안 알려 준다」는 인상을
 * 만든다 — 그러면 사람은 알려 주는 쪽만 믿고 나머지는 도구가 고장난 것으로 읽는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { initHarness, readState, writeState } from '../src/state';
import { runDoctor } from '../src/doctor';
import { runtimeDir } from '../src/paths';
import type { Phase } from '../src/types';

const sandbox = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-ux3i-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  return root;
};

function cli(root: string, argv: string[]): { code: number; err: string; out: string } {
  const oe = console.error, ol = console.log;
  let err = '', out = '';
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  try { return { code: run(argv, root), err, out }; } finally { console.error = oe; console.log = ol; }
}

describe('[UX-120] 성공 출력이 무슨 일이 났는지 말한다', () => {
  it('`doc upsert` 가 생성과 갱신을 구분한다', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, 'concept.md'), '# 개념\n내용\n');
    const first = cli(root, ['doc', 'upsert', '--id', 'DOC-1', '--path', 'concept.md', '--phase', 'P0']);
    expect(first.out).toMatch(/created|생성/);
    const second = cli(root, ['doc', 'upsert', '--id', 'DOC-1', '--path', 'concept.md', '--phase', 'P0']);
    expect(second.out, '같은 id 로 두 번 불렀는데 무엇을 덮었는지 모른다').toMatch(/updated|갱신/);
  });

  it('`doc upsert` 가 다음 수(발행 → URL 등록)를 말한다', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, 'concept.md'), '# 개념\n내용\n');
    const r = cli(root, ['doc', 'upsert', '--id', 'DOC-1', '--path', 'concept.md', '--phase', 'P0']);
    expect(r.out).toMatch(/harness doc url DOC-1/);
  });

  it('`node upsert` 도 생성과 갱신을 구분한다', () => {
    const root = sandbox();
    expect(cli(root, ['node', 'upsert', '--id', 'F-1', '--title', '로그인']).out).toMatch(/created|등록/);
    expect(cli(root, ['node', 'upsert', '--id', 'F-1', '--title', '로그인2']).out).toMatch(/updated|갱신/);
  });
});

describe('[UX-124] `doc submit` 거부문에 칠 수 있는 명령이 있다', () => {
  it('URL 미등록 문서를 제출하면 정확한 명령을 처방한다', () => {
    const root = sandbox();
    fs.writeFileSync(path.join(root, 'concept.md'), '# 개념\n내용\n');
    cli(root, ['doc', 'upsert', '--id', 'DOC-1', '--path', 'concept.md', '--phase', 'P0']);
    const r = cli(root, ['doc', 'submit', 'DOC-1']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/harness doc url DOC-1/);
    expect(r.err, '내부 함수명을 사용자에게 노출하면 안 된다').not.toMatch(/setDocArtifactUrl/);
  });
});

describe('[UX-162] `design sync` 가 원시 ENOENT 를 내지 않는다', () => {
  it('없는 파일이면 세공된 오류와 처방을 낸다', () => {
    const root = sandbox();
    cli(root, ['node', 'upsert', '--id', 'UX-7', '--title', '화면']);
    const r = cli(root, ['design', 'sync', 'UX-7', '--from', 'no-such-file.md']);
    expect(r.code).toBe(1);
    expect(r.err, '가공 없는 원시 에러가 그대로 나갔다').not.toMatch(/^ENOENT/m);
    expect(r.err).toMatch(/no-such-file\.md/);        // 어느 파일인지
    expect(r.err).toMatch(/--from/);                  // 어떻게 고치는지
  });
});

describe('[UX-163] doctor 경고가 로그 위치를 말한다', () => {
  it('훅 판정 실패 경고에 `hook-errors.log` 경로가 실린다', () => {
    const root = sandbox();
    const log = path.join(runtimeDir(root), 'hook-errors.log');
    fs.mkdirSync(runtimeDir(root), { recursive: true });
    fs.writeFileSync(log, 'boom\n');
    const warnings = runDoctor(root).warnings.join('\n');
    expect(warnings).toMatch(/hook decision failure|훅 판정 실패/);
    expect(warnings, '원인을 확인하라면서 어디를 볼지 말하지 않는다').toContain(log);
  });
});
