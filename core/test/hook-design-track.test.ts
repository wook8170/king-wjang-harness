/**
 * [UX-71] **설계 트랙이 막아야 하는 것은 「구현」이지 「허용목록에 없는 모든 것」이 아니다.**
 *
 * 판정이 `design_allowed_prefixes` **allow-list** 하나뿐이라 소스가 아닌 파일도 전부 막혔다.
 * 실측(P0·P3·P6 동일): 막아야 할 것 22/22 는 맞았지만 **막으면 안 되는 것 33종 중 27종이
 * deny** — `notes.txt`·`.gitignore`·`.env.example`·`assets/logo.svg`·`package.json`·
 * `test/a.test.ts` 가 전부 걸렸다. 게다가 사유는 전부 "Source code cannot be written in the
 * design track" 이라 **사실과 달랐다**(`.gitignore` 는 소스 코드가 아니다).
 *
 * 과차단은 이 제품에서 결함과 같은 무게다 — 설계 구간에 리포지토리를 초기화하지도, 수용
 * 기준을 테스트로 적지도 못하면 사람이 하네스를 꺼버리고, 그러면 방어가 0이 된다.
 *
 * 판정을 **deny-list 2단**으로 바꾼다:
 *  (1) 프로파일이 선언한 소스 경로(`source_globs`) — 스택별 정의는 프로파일 몫(§9)
 *  (2) 소스 코드 확장자 — **프로파일이 얇을 때의 바닥.** generic 은 `src/**·lib/**·app/**`
 *      뿐이라 (1)만 쓰면 `server/api.go` 가 통째로 열린다(스펙 §12가 고지한 한계).
 * 둘 중 하나라도 걸리면 deny, 아니면 allow. **사유는 실제로 걸린 쪽을 말한다.**
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import type { Phase } from '../src/types';

const setup = (phase: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-ux71-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  return root;
};

const writeVerdict = (root: string, p: string) => handleHook(root, 'pre-tool', {
  tool_name: 'Write', tool_input: { file_path: path.join(root, p) },
}) as any;

const denied = (root: string, p: string): boolean =>
  writeVerdict(root, p)?.hookSpecificOutput?.permissionDecision === 'deny';

/** Bash 표면 판정 — Write 와 **같은 규칙 한 벌**을 타는지 보는 것이 요점이다(SEC-50). */
const bashVerdict = (root: string, command: string) => handleHook(root, 'pre-tool', {
  tool_name: 'Bash', tool_input: { command },
}) as any;
const deniedBash = (root: string, command: string): boolean =>
  bashVerdict(root, command)?.hookSpecificOutput?.permissionDecision === 'deny';

const reasonOf = (root: string, p: string): string => {
  const out = writeVerdict(root, p);
  return out ? String(out.hookSpecificOutput.permissionDecisionReason) : '';
};

const bashDenied = (root: string, command: string): boolean => {
  const out = handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } } as any) as any;
  return out?.hookSpecificOutput?.permissionDecision === 'deny';
};

// ─────────────────────────────────────────────────────────────────────────────
// 막아야 할 것 — 「구현을 막는다」는 핵심 계약이 약해지면 안 된다.
// ─────────────────────────────────────────────────────────────────────────────
describe('설계 트랙: 구현은 여전히 막는다 (UX-71)', () => {
  it('프로파일이 선언한 소스 경로', () => {
    const root = setup('P2');
    for (const p of ['src/app.ts', 'src/components/Button.tsx', 'lib/util.js',
      'app/page.tsx', 'src/main.py', 'src/db/query.sql']) {
      expect(denied(root, p), p).toBe(true);
    }
  });

  it('프로파일 밖 소스도 확장자 바닥으로 막는다 — 얇은 프로파일이 구멍이 되면 안 된다', () => {
    const root = setup('P2'); // generic: src/** lib/** app/** 뿐이다
    for (const p of ['server/api.go', 'internal/handler.go', 'pkg/service/user.rs',
      'backend/models.py', 'api/routes.rb', 'Sources/App/main.swift',
      'domain/Order.java', 'worker/index.mjs', 'ui/Widget.vue', 'web/Page.svelte']) {
      expect(denied(root, p), p).toBe(true);
    }
  });

  it('선언된 소스 트리 안이면 테스트 접미사로 우회할 수 없다', () => {
    expect(denied(setup('P2'), 'src/app.test.ts')).toBe(true);
  });

  it('설계 페이즈 전 구간(P0~P6)에서 같다', () => {
    for (const ph of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as Phase[]) {
      expect(denied(setup(ph), 'src/app.ts'), ph).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 막으면 안 되는 것 — 과차단은 결함과 같은 무게다.
// ─────────────────────────────────────────────────────────────────────────────
describe('설계 트랙: 소스가 아닌 것은 막지 않는다 (UX-71 과차단)', () => {
  it('설정 파일', () => {
    const root = setup('P2');
    for (const p of ['.gitignore', '.env.example', 'package.json', 'tsconfig.json',
      '.editorconfig', 'Makefile', 'Dockerfile', '.github/workflows/ci.yml',
      'config/settings.yaml', 'requirements.txt']) {
      expect(denied(root, p), p).toBe(false);
    }
  });

  it('자산·데이터·메모', () => {
    const root = setup('P2');
    for (const p of ['notes.txt', 'assets/logo.svg', 'assets/hero.png', 'public/favicon.ico',
      'LICENSE', 'data/seed.csv', 'styles/theme.css', 'scripts/setup.sh']) {
      expect(denied(root, p), p).toBe(false);
    }
  });

  it('테스트는 **이름**으로 자기를 밝힌다 — 디렉토리 이름만으로는 예외가 아니다', () => {
    const root = setup('P2');
    for (const p of ['test/a.test.ts', 'tests/e2e/login.spec.ts', '__tests__/util.test.js',
      'spec/models/user_spec.rb', 'e2e/checkout.spec.ts', 'internal/handler_test.go',
      'tests/test_engine.py', 'internal/UserTest.java', 'conftest.py']) {
      expect(denied(root, p), p).toBe(false);
    }
  });

  /**
   * 적대적 검증이 실증한 구멍: 첫 판은 디렉토리 이름만으로 예외를 줘서, 경로 앞에 `test/`
   * 여섯 글자를 붙이면 P0~P6 내내 제품 전체를 쓸 수 있었다. 이름 규칙으로 좁혀 닫았다.
   * 대가는 이름 없는 보조 파일(`test/helpers/factory.ts`)이 막히는 것 — **의도된 계약**이다.
   */
  it('테스트 디렉토리 접두사로 구현을 숨길 수 없다', () => {
    const root = setup('P2');
    for (const p of ['test/app.ts', 'tests/server.go', 'spec/engine.py',
      '__tests__/payments.ts', 'e2e/checkout.ts', 'test/helpers/factory.ts']) {
      expect(denied(root, p), p).toBe(true);
    }
  });

  /**
   * `.json`·`.yaml` 을 「설정이라 구현이 아니다」로 빼놓고 `next.config.js` 를 막으면 같은
   * 설정이 확장자에 따라 갈리고, SessionStart 의 「설정은 쓸 수 있다」가 거짓이 된다.
   */
  it('설정 파일은 확장자가 소스여도 쓸 수 있다', () => {
    const root = setup('P2');
    for (const p of ['next.config.js', 'vite.config.ts', 'vitest.config.ts', 'jest.config.mjs',
      'tailwind.config.js', 'playwright.config.ts', 'karma.conf.js', '.eslintrc.js',
      'gulpfile.js', 'knexfile.js']) {
      expect(denied(root, p), p).toBe(false);
    }
  });

  /**
   * 적대적 검증이 **E2E 로 실증한 구멍**: 리터럴 경로(`config/settings.yaml`)만 보고 판정하면
   * 심링크가 가리키는 `src/app.ts` 를 그대로 덮어쓴다. 바로 위 allow-list 는 `[rel, realRel]`
   * 양쪽을 보는데 최종 판정만 한쪽을 골랐던 **비대칭**이 원인이었다.
   */
  it('심링크로 소스를 겨누면 리터럴 경로가 설정이어도 막는다', () => {
    const root = setup('P2');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const a = 1;\n');
    fs.symlinkSync(path.join(root, 'src/app.ts'), path.join(root, 'config/settings.yaml'));
    expect(denied(root, 'config/settings.yaml')).toBe(true);
    expect(reasonOf(root, 'config/settings.yaml')).toMatch(/src\/app\.ts/); // 실제로 걸린 경로를 말한다
    // 심링크가 소스를 겨누지 않으면 그대로 통과 — 심링크 자체를 막는 것이 아니다.
    fs.writeFileSync(path.join(root, 'notes.md'), '# x\n');
    fs.symlinkSync(path.join(root, 'notes.md'), path.join(root, 'config/other.yaml'));
    expect(denied(root, 'config/other.yaml')).toBe(false);
  });

  it('설계 산출물·docs·루트 md 는 그대로 허용 — 기존 계약 유지', () => {
    const root = setup('P2');
    for (const p of ['.harness/design/00-concept.md', '.harness/packets/P0.md',
      'docs/note.md', 'README.md']) {
      expect(denied(root, p), p).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 사유가 실제 판정 이유와 일치해야 한다.
// ─────────────────────────────────────────────────────────────────────────────
describe('설계 트랙: 사유는 실제로 걸린 규칙을 말한다 (UX-71)', () => {
  it('source_globs 로 걸렸으면 그렇게 말한다', () => {
    const r = reasonOf(setup('P2'), 'src/app.ts');
    expect(r).toMatch(/source_globs/);
    expect(r).toMatch(/src\/\*\*/);
  });

  it('확장자 바닥으로 걸렸으면 그렇게 말한다 — 프로파일 탓을 하지 않는다', () => {
    const r = reasonOf(setup('P2'), 'server/api.go');
    expect(r).toMatch(/\.go/);
    expect(r).not.toMatch(/source_globs/);
  });

  // 스위트 전역이 ko 로 고정돼 있다(`core/test/setup.ts`) — 영문 문구는 명시적으로 해제해 본다.
  it('「소스가 아닌 것은 쓸 수 있다」는 사실을 함께 말한다 (ko)', () => {
    const r = reasonOf(setup('P2'), 'src/app.ts');
    expect(r).toMatch(/문서·자산·설정.*이름이 테스트인/);
    expect(r).toMatch(/[가-힣]/);
  });

  it('en 문구도 같은 사실을 말한다', () => {
    const prev = process.env.HARNESS_LANG;
    process.env.HARNESS_LANG = 'en';
    try {
      const r = reasonOf(setup('P2'), 'src/app.ts');
      expect(r).toMatch(/source_globs/);
      expect(r.toLowerCase()).toMatch(/documents, assets, configuration[\s\S]*named[\s\S]*as tests/);
      expect(r).not.toMatch(/[가-힣]/);
    } finally {
      process.env.HARNESS_LANG = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 정의는 프로파일이 준다 (§9) · 다른 표면도 같은 판정이어야 한다.
// ─────────────────────────────────────────────────────────────────────────────
describe('설계 트랙: 프로파일이 소스 정의를 준다 (UX-71)', () => {
  const withProfile = (globs: string) => {
    const root = setup('P2');
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'),
      `name: t\ndescription: t\nsource_globs: [${globs}]\ndeploy_commands: []\ndesign_system_roots: []\n`);
    return root;
  };

  it('프로파일이 선언한 곳은 확장자와 무관하게 소스다', () => {
    const root = withProfile('server/**');
    expect(denied(root, 'server/notes.txt')).toBe(true);
  });

  it('선언 밖이면서 소스 확장자도 아니면 허용', () => {
    expect(denied(withProfile('server/**'), 'src/notes.txt')).toBe(false);
  });

  it('프로파일이 좁아도 확장자 바닥은 계속 문다', () => {
    expect(denied(withProfile('server/**'), 'src/app.ts')).toBe(true);
  });
});

describe('설계 트랙: 표면이 갈리지 않는다 (UX-71)', () => {
  it('셸 리다이렉트도 같은 판정을 쓴다', () => {
    const root = setup('P2');
    expect(bashDenied(root, 'echo "x" > src/app.ts')).toBe(true);
    expect(bashDenied(root, 'echo "x" > server/api.go')).toBe(true);
    expect(bashDenied(root, 'echo "node_modules" > .gitignore')).toBe(false);
    expect(bashDenied(root, 'echo "x" > notes.txt')).toBe(false);
    expect(bashDenied(root, 'echo "{}" > package.json')).toBe(false);
  });

  it('정책·상태 파일 보호는 그대로 — 확장자가 소스가 아니어도 막힌다 (SEC-69 회귀 가드)', () => {
    const root = setup('P2');
    expect(denied(root, '.harness/config.yaml')).toBe(true);
    expect(denied(root, '.harness/state.json')).toBe(true);
    expect(denied(root, '.harness/profile/profile.yaml')).toBe(true);
    expect(bashDenied(root, 'echo x > .harness/config.yaml')).toBe(true);
  });

  it('구축 트랙(P8)에는 이 차단이 없다 — 구현이 본업이다', () => {
    const root = setup('P8');
    expect(denied(root, 'src/app.ts')).toBe(false);
    expect(denied(root, 'server/api.go')).toBe(false);
  });
});

/**
 * [SEC-90/91] 독립 재감정(실효성 축)이 실증한 **에이전트 레인** 구멍 두 계열.
 *
 * 사용자가 자기 터미널에서 치는 것은 의도된 탈출구다 — 여기서 재는 것은 **모델이 낸 Bash
 * 도구 호출**이 훅을 통과하는지다. 둘 다 「막힐 거라 예상한 목록」에는 없던 축이라
 * 자기 채점으로는 구조적으로 안 보였다([OPS-74]).
 */
describe('SEC-90: 접두 명령이 쓰기 스캐너를 끄지 못한다', () => {
  const PREFIXES = ['sudo', 'nohup', 'time', 'env', 'command', 'nice', 'exec', 'doas',
    'timeout 5', 'nice -n 10', 'sudo -u me', 'env X=1'];
  const TARGETS = ['tee src/app.ts', 'cp /tmp/x src/app.ts', 'sed -i "" s/a/b/ src/app.ts',
    'tee .harness/events.jsonl', 'cp /tmp/x .harness/state.json'];

  it('접두 × 표적 전건 deny', () => {
    const root = setup('P2');
    const allowed: string[] = [];
    for (const p of PREFIXES) {
      for (const t of TARGETS) {
        const cmd = `${p} ${t}`;
        if (!deniedBash(root, cmd)) allowed.push(cmd);
      }
    }
    expect(allowed).toEqual([]);
  });

  it('과차단 금지 — 접두가 붙어도 읽기·테스트는 통과한다', () => {
    const root = setup('P2');
    for (const c of ['sudo ls', 'time npm test', 'nice -n 10 npm test', 'sudo cat /etc/hosts',
      'env', 'tee docs/note.md', 'sudo tee .harness/evidence/w1/shot.png']) {
      expect(deniedBash(root, c), c).toBe(false);
    }
  });
});

describe('SEC-91: 디렉토리를 대상으로 준 쓰기도 같은 판정을 받는다', () => {
  it('소스 트리·코어 디렉토리를 겨눈 것은 deny', () => {
    const root = setup('P2');
    const allowed: string[] = [];
    for (const c of ['cp -r /tmp/dir src', 'cp -r /tmp/dir src/', 'mv /tmp/x src',
      'rsync -a /tmp/d/ src', 'tar -C src -xf /tmp/a.tar', 'unzip -d src /tmp/a.zip',
      'git clone https://x src', 'cp -r /tmp/x .harness', 'mv /tmp/x .harness',
      'tar -C .harness -xf /tmp/a.tar', 'cp -r /tmp/x .harness/profile',
      'find . -name "*.ts" -exec sed -i "" s/a/b/ {} +']) {
      if (!deniedBash(root, c)) allowed.push(c);
    }
    expect(allowed).toEqual([]);
  });

  it('과차단 금지 — 소스가 아닌 디렉토리와 읽기 전용 find 는 통과한다', () => {
    const root = setup('P2');
    for (const c of ['cp -r /tmp/dir docs', 'mv /tmp/x docs/a.md', 'tar -C docs -xf /tmp/a.tar',
      'cp -r /tmp/x .harness/evidence/w1', 'find . -name "*.md" -print',
      'find . -type f -exec cat {} +', 'git clone https://x /tmp/scratch',
      'cp -r /tmp/dir assets', 'rsync -a /tmp/d/ docs']) {
      expect(deniedBash(root, c), c).toBe(false);
    }
  });

  it('구축 트랙에서는 소스 디렉토리가 열리고 코어는 계속 막힌다 — 페이즈 계약은 그대로다', () => {
    const root = setup('P8');
    expect(deniedBash(root, 'mv /tmp/x src')).toBe(false);
    expect(deniedBash(root, 'cp -r /tmp/x .harness')).toBe(true);
  });
});
