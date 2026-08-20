import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as YAML from 'yaml';
import {
  GENERIC_FLOOR,
  bundledProfilesDir,
  commandFor,
  inspectProfile,
  isDeployCommand,
  isSourcePath,
  loadProfile,
  localProfileDir,
} from '../src/profile';
import { DEFAULT_CONFIG } from '../src/config';
import { isFrozenPath } from '../src/tokens';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-prof-'));

const writeConfig = (root: string, content: string) => {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/config.yaml'), content);
};

/** `.harness/profile/` 에 프로젝트 로컬 프로파일을 깐다. */
const writeLocal = (root: string, files: Record<string, string>) => {
  const dir = localProfileDir(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
};

const repoRoot = path.resolve(__dirname, '..', '..');

describe('bundledProfilesDir', () => {
  it('실재하는 디렉토리를 가리킨다', () => {
    const dir = bundledProfilesDir();
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('번들 프로파일 2종이 그 안에 있다', () => {
    const dir = bundledProfilesDir();
    for (const name of ['generic', 'nextjs-prisma']) {
      expect(fs.existsSync(path.join(dir, name, 'profile.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(dir, name, 'commands.yaml'))).toBe(true);
    }
  });

  it('core/src(vitest)·core/dist(번들) 양쪽에서 같은 곳으로 풀린다', () => {
    // 두 실행 형태 모두 __dirname 이 repo/core/{src,dist} 라 2단 상위가 repo/profiles 다.
    const fromSrc = path.resolve(repoRoot, 'core', 'src', '..', '..', 'profiles');
    const fromDist = path.resolve(repoRoot, 'core', 'dist', '..', '..', 'profiles');
    const expected = path.join(repoRoot, 'profiles');
    expect(fromSrc).toBe(expected);
    expect(fromDist).toBe(expected);
    expect(bundledProfilesDir()).toBe(expected);
  });
});

describe('loadProfile — 해석 순서', () => {
  it('아무것도 없으면 generic 이 바닥', () => {
    const { profile, problems } = inspectProfile(tmp());
    expect(profile.name).toBe('generic');
    expect(profile.origin).toBe('bundled');
    expect(profile.sourceGlobs).toContain('src/**');
    expect(problems).toEqual([]);
  });

  it('번들 generic 의 deploy_commands 는 config 기본 차단 목록과 같다', () => {
    // 두 곳이 갈라지면 어느 쪽이 정본인지 아무도 모르게 된다.
    expect(loadProfile(tmp()).deployCommands).toEqual(DEFAULT_CONFIG.design_blocked_bash);
  });

  it('코드 내장 바닥값이 번들 generic/profile.yaml 과 일치한다', () => {
    const raw = YAML.parse(
      fs.readFileSync(path.join(bundledProfilesDir(), 'generic', 'profile.yaml'), 'utf8'),
    ) as Record<string, unknown>;
    expect(raw.name).toBe(GENERIC_FLOOR.name);
    expect(raw.source_globs).toEqual(GENERIC_FLOOR.sourceGlobs);
    expect(raw.deploy_commands).toEqual(GENERIC_FLOOR.deployCommands);
    expect(raw.design_system_roots).toEqual(GENERIC_FLOOR.designSystemRoots);
  });

  it('nextjs-prisma 는 실제 명령·경로를 들고 온다', () => {
    const p = loadProfile(tmp(), 'nextjs-prisma');
    expect(p.name).toBe('nextjs-prisma');
    expect(p.origin).toBe('bundled');
    expect(commandFor(p, 'test')).toBe('npm test');
    expect(commandFor(p, 'build')).toBe('npm run build');
    expect(commandFor(p, 'e2e')).toBe('npx playwright test');
    expect(commandFor(p, 'dev-server')).toBe('npm run dev');
    expect(commandFor(p, 'deploy')).toBe('vercel deploy');
    expect(p.sourceGlobs).toEqual(['src/**', 'app/**', 'prisma/**', 'components/**']);
    expect(p.designSystemRoots).toContain('src/components/ui');
  });

  it('designSystemRoots 는 isFrozenPath(접두사 대조)가 실제로 쓸 수 있는 모양이다', () => {
    // 글롭(`.../**`)을 담으면 접두사 대조가 아무것도 못 잡아 동결이 조용히 헛돈다.
    const roots = loadProfile(tmp(), 'nextjs-prisma').designSystemRoots;
    expect(roots.every(r => !r.includes('*'))).toBe(true);
    const root = tmp();
    expect(isFrozenPath(root, 'src/components/ui/button.tsx', { frozenRoots: roots })).toBe(true);
    expect(isFrozenPath(root, 'src/components/nav.tsx', { frozenRoots: roots })).toBe(false);
  });

  it('name 인자가 없으면 config.yaml 의 profile 을 쓴다', () => {
    const root = tmp();
    writeConfig(root, 'profile: nextjs-prisma\n');
    expect(loadProfile(root).name).toBe('nextjs-prisma');
  });

  it('인자로 준 이름이 config.yaml 보다 우선한다', () => {
    const root = tmp();
    writeConfig(root, 'profile: nextjs-prisma\n');
    expect(loadProfile(root, 'generic').name).toBe('generic');
  });

  it('.harness/profile/ 이 있으면 번들보다 우선한다', () => {
    const root = tmp();
    writeLocal(root, {
      'profile.yaml': 'name: my-stack\nsource_globs: [packages/**]\ndeploy_commands: [make ship]\n',
      'commands.yaml': 'test: cargo test\n',
    });
    const p = loadProfile(root, 'nextjs-prisma'); // 번들 이름을 줘도 로컬이 이긴다
    expect(p.name).toBe('my-stack');
    expect(p.origin).toBe('local');
    expect(p.dir).toBe(localProfileDir(root));
    expect(p.sourceGlobs).toEqual(['packages/**']);
    expect(commandFor(p, 'test')).toBe('cargo test');
  });

  it('없는 프로파일 이름은 generic 으로 떨어지고 사유가 남는다', () => {
    const { profile, problems } = inspectProfile(tmp(), 'no-such-stack');
    expect(profile.name).toBe('generic');
    expect(problems.join('\n')).toContain('no-such-stack');
  });

  it('경로 탈출 이름은 읽지 않고 generic 으로 떨어진다', () => {
    const { profile, problems } = inspectProfile(tmp(), '../../etc');
    expect(profile.name).toBe('generic');
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('inspectProfile — 관용적 스킵의 관측 가능성', () => {
  it('깨진 profile.yaml 은 generic 폴백 + 문제 보고', () => {
    const root = tmp();
    writeLocal(root, { 'profile.yaml': '{{{\n', 'commands.yaml': 'test: x\n' });
    const { profile, problems } = inspectProfile(root);
    expect(profile.name).toBe('generic');
    expect(profile.origin).toBe('bundled');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('profile.yaml');
    expect(loadProfile(root).name).toBe('generic'); // loadProfile 도 같은 폴백
  });

  it('profile.yaml 최상위가 매핑이 아니면 폴백 + 보고', () => {
    const root = tmp();
    writeLocal(root, { 'profile.yaml': '- a\n- b\n' });
    const { profile, problems } = inspectProfile(root);
    expect(profile.name).toBe('generic');
    expect(problems.join('\n')).toContain('매핑');
  });

  it('source_globs 가 없으면 generic 기본값으로 메우고 보고한다', () => {
    // 빈 소스 경로 = §4-2 차단이 통째로 열림. 조용히 비워둘 수 없다.
    const root = tmp();
    writeLocal(root, { 'profile.yaml': 'name: thin\n', 'commands.yaml': 'test: x\n' });
    const { profile, problems } = inspectProfile(root);
    expect(profile.name).toBe('thin');
    expect(profile.sourceGlobs).toEqual(GENERIC_FLOOR.sourceGlobs);
    expect(profile.deployCommands).toEqual(GENERIC_FLOOR.deployCommands);
    expect(problems.join('\n')).toContain('source_globs');
    expect(problems.join('\n')).toContain('deploy_commands');
  });

  it('source_globs 가 스칼라(오타)면 기본값으로 정규화하고 보고한다', () => {
    const root = tmp();
    writeLocal(root, { 'profile.yaml': 'name: thin\nsource_globs: src/**\n' });
    const { profile, problems } = inspectProfile(root);
    expect(profile.sourceGlobs).toEqual(GENERIC_FLOOR.sourceGlobs);
    expect(problems.join('\n')).toContain('source_globs');
  });

  it('commands.yaml 이 없으면 빈 매핑 + 보고', () => {
    const root = tmp();
    writeLocal(root, { 'profile.yaml': 'name: thin\nsource_globs: [a/**]\ndeploy_commands: [x]\n' });
    const { profile, problems } = inspectProfile(root);
    expect(profile.commands).toEqual({});
    expect(problems.join('\n')).toContain('commands.yaml');
  });

  it('commands.yaml 의 문자열 아닌 값은 버리고 보고한다', () => {
    const root = tmp();
    writeLocal(root, {
      'profile.yaml': 'name: thin\nsource_globs: [a/**]\ndeploy_commands: [x]\n',
      'commands.yaml': 'test: npm test\nbuild: [1, 2]\n',
    });
    const { profile, problems } = inspectProfile(root);
    expect(profile.commands).toEqual({ test: 'npm test' });
    expect(problems.join('\n')).toContain('build');
  });

  it('.harness/profile 이 파일이면 무시하고 보고한다', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(localProfileDir(root), 'not a directory\n');
    const { profile, problems } = inspectProfile(root);
    expect(profile.name).toBe('generic');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('정상 번들 프로파일은 문제를 만들지 않는다', () => {
    expect(inspectProfile(tmp(), 'nextjs-prisma').problems).toEqual([]);
    expect(inspectProfile(tmp(), 'generic').problems).toEqual([]);
  });
});

describe('isSourcePath', () => {
  const p = loadProfile(process.cwd(), 'nextjs-prisma');

  it('src/** 는 하위 전체를 잡는다', () => {
    expect(isSourcePath(p, 'src/a/b.ts')).toBe(true);
    expect(isSourcePath(p, 'src/x.ts')).toBe(true);
    expect(isSourcePath(p, 'prisma/schema.prisma')).toBe(true);
  });

  it('소스 밖은 잡지 않는다', () => {
    expect(isSourcePath(p, 'docs/x.md')).toBe(false);
    expect(isSourcePath(p, '.harness/design/ledger.yaml')).toBe(false);
    expect(isSourcePath(p, 'README.md')).toBe(false);
    expect(isSourcePath(p, 'sources/a.ts')).toBe(false); // 접두사 우연 일치 금지
  });

  it('./ 접두·백슬래시·선행 슬래시를 정규화한다', () => {
    expect(isSourcePath(p, './src/a/b.ts')).toBe(true);
    expect(isSourcePath(p, 'src\\a\\b.ts')).toBe(true);
    expect(isSourcePath(p, '/src/a/b.ts')).toBe(true);
  });

  it('빈 값·비문자열은 false (throw 없음)', () => {
    expect(isSourcePath(p, '')).toBe(false);
    expect(isSourcePath(p, undefined as unknown as string)).toBe(false);
  });

  it('sourceGlobs 가 비면 아무것도 잡지 않는다', () => {
    expect(isSourcePath({ ...p, sourceGlobs: [] }, 'src/a.ts')).toBe(false);
  });

  it('* 는 경로 구분자를 넘지 않는다', () => {
    const q = { ...p, sourceGlobs: ['src/*.ts'] };
    expect(isSourcePath(q, 'src/a.ts')).toBe(true);
    expect(isSourcePath(q, 'src/deep/a.ts')).toBe(false);
  });

  it('**/ 는 0개 디렉토리도 잡는다', () => {
    const q = { ...p, sourceGlobs: ['**/*.test.ts'] };
    expect(isSourcePath(q, 'a.test.ts')).toBe(true);
    expect(isSourcePath(q, 'a/b/c.test.ts')).toBe(true);
    expect(isSourcePath(q, 'a/b/c.ts')).toBe(false);
  });

  it('와일드카드 없는 패턴은 정확 일치', () => {
    const q = { ...p, sourceGlobs: ['next.config.js'] };
    expect(isSourcePath(q, 'next.config.js')).toBe(true);
    expect(isSourcePath(q, 'nextxconfig.js')).toBe(false); // . 이 정규식 임의문자로 새면 안 된다
  });
});

describe('isDeployCommand', () => {
  const p = loadProfile(process.cwd(), 'nextjs-prisma');

  it('플래그가 붙어도 잡는다', () => {
    expect(isDeployCommand(p, 'vercel deploy --prod')).toBe(true);
    expect(isDeployCommand(p, 'npx prisma migrate deploy')).toBe(true);
    expect(isDeployCommand(p, 'docker push ghcr.io/x/y:1')).toBe(true);
  });

  it('공백·대소문자 우회를 막는다', () => {
    expect(isDeployCommand(p, 'vercel   deploy')).toBe(true);
    expect(isDeployCommand(p, 'VERCEL DEPLOY')).toBe(true);
    expect(isDeployCommand(p, 'cd app && vercel deploy')).toBe(true);
  });

  it('배포가 아닌 명령은 통과', () => {
    expect(isDeployCommand(p, 'npm test')).toBe(false);
    expect(isDeployCommand(p, 'git status')).toBe(false);
    expect(isDeployCommand(p, '')).toBe(false);
  });

  it('deployCommands 가 비면 아무것도 막지 않는다', () => {
    expect(isDeployCommand({ ...p, deployCommands: [] }, 'vercel deploy')).toBe(false);
  });

  it('빈 문자열 항목이 전체 차단으로 번지지 않는다', () => {
    expect(isDeployCommand({ ...p, deployCommands: ['', '  '] }, 'npm test')).toBe(false);
  });
});

describe('commandFor', () => {
  it('모르는 키는 undefined', () => {
    expect(commandFor(loadProfile(process.cwd(), 'nextjs-prisma'), 'lint')).toBeUndefined();
  });

  it('generic 의 빈 자리표는 undefined (지어내지 않는다)', () => {
    const g = loadProfile(tmp(), 'generic');
    for (const k of ['test', 'build', 'deploy', 'e2e', 'dev-server']) {
      expect(commandFor(g, k)).toBeUndefined();
    }
  });

  it('프로토타입 오염 키를 명령으로 오인하지 않는다', () => {
    const g = loadProfile(tmp(), 'generic');
    expect(commandFor(g, 'constructor')).toBeUndefined();
    expect(commandFor(g, 'toString')).toBeUndefined();
  });
});

describe('불변식', () => {
  it('반환 배열은 GENERIC_FLOOR 와 다른 참조 (호출측 변형이 새지 않는다)', () => {
    const a = loadProfile(tmp());
    const b = loadProfile(tmp());
    expect(a.sourceGlobs).not.toBe(GENERIC_FLOOR.sourceGlobs);
    expect(a.sourceGlobs).not.toBe(b.sourceGlobs);
    expect(a.deployCommands).not.toBe(GENERIC_FLOOR.deployCommands);
  });

  it('같은 입력이면 같은 결과 (시각·난수 없음)', () => {
    const root = tmp();
    expect(loadProfile(root, 'nextjs-prisma')).toEqual(loadProfile(root, 'nextjs-prisma'));
  });
});
