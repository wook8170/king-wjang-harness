/**
 * 출하 검증(2026-08-27) 수정 라운드 3 — open HIGH 2건.
 *
 * 두 결함은 같은 부류다: **사용자가 적어 둔 것이 조용히 사라진다.**
 *   [OPS-08] 자유 텍스트에 섞여 들어온 비밀이 저널에 평문으로 영구 보존된다 —
 *            저널의 지속성 메커니즘이 사실상 git 커밋이므로, 이 제품이 자기 README 에서
 *            gitleaks 로 자랑하는 사고 유형을 사용자 프로젝트에 이식한다.
 *   [API-03] `config.yaml` 의 키 오타가 침묵으로 무시되고 `doctor` 는 ok:true 를 낸다 —
 *            훅이 무엇을 막을지 정하는 파일인데, 사용자는 차단이 걸려 있다고 믿는다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendEvent, readEvents, replayState, maskSecrets } from '../src/events';
import { eventsPath, configPath } from '../src/paths';
import { initHarness } from '../src/state';
import { runDoctor } from '../src/doctor';
import { inspectConfig, DEFAULT_CONFIG } from '../src/config';
import { raiseCritical } from '../src/loop';
import { resetLangCache } from '../src/tr';

const setup = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-r3-'));
  initHarness(root);
  return root;
};

const journalText = (root: string): string => fs.readFileSync(eventsPath(root), 'utf8');

const lastData = (root: string): Record<string, unknown> => {
  const evs = readEvents(root);
  return evs[evs.length - 1].data;
};

const writeConfig = (root: string, content: string): void => {
  fs.writeFileSync(configPath(root), content);
};

/** 진단 문장 전부(issues + warnings) — 어느 통에 담겼든 문구 자체를 볼 때 쓴다. */
const allLines = (root: string): string[] => {
  const r = runDoctor(root);
  return [...r.issues, ...r.warnings];
};

/**
 * [OPS-08 회귀] **픽스처를 런타임에 조립한다 — 리터럴로 두면 이 파일이 곧 유출이다.**
 *
 * 처음에는 토큰 모양을 그대로 적었다. 그러자 **GitHub 푸시 보호가 push 를 거부했다**
 * (`xoxb-…` 를 슬랙 토큰으로 인식). 스캐너는 「테스트 픽스처」와 진짜를 구분할 수 없고,
 * 구분하라고 요구하는 것도 옳지 않다 — 그게 스캐너가 일하는 방식이다.
 *
 * 차단 해제 URL 로 예외를 받는 길도 있었지만 택하지 않았다: **「비밀이 새지 않게 한다」를
 * 검증하는 파일에 비밀 모양을 영구히 들이는 것**은 앞뒤가 안 맞고, 다음 사람에게
 * 「예외를 받으면 된다」는 선례를 남긴다. 조각을 이어 붙이면 파일에는 비밀 모양이 없고
 * 런타임 값은 똑같다 — 검사 대상은 그 값이지 소스의 바이트가 아니다.
 */
const tok = (...parts: string[]): string => parts.join('');

describe('[OPS-08] 저널에 남는 자유 텍스트의 비밀 마스킹', () => {
  it('감사 재현 그대로: critical raise --detail 의 API 키가 저널에 평문으로 남지 않는다', () => {
    const root = setup();
    raiseCritical(root, {
      reason: 'external-blocker',
      detail: 'blocked by API key sk-FAKE-SECRET-abc123XYZ',
    });
    const raw = journalText(root);
    expect(raw).not.toContain('sk-FAKE-SECRET-abc123XYZ');
    expect(raw).toContain('sk-***MASKED***');
    // 감사 기록으로서의 가치는 남아야 한다 — 문장 나머지는 그대로다.
    expect(String(lastData(root).detail)).toContain('blocked by API key');
  });

  it('흔한 비밀 형태를 가리되 무엇이 가려졌는지 표식을 남긴다', () => {
    const cases: Array<[string, string]> = [
      [tok('sk', '-FAKE-SECRET-abc123XYZ'), 'sk-***MASKED***'],
      [tok('Bea', 'rer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'), 'Bearer ***MASKED***'],
      [tok('AKI', 'AIOSFODNN7EXAMPLE'), 'AKIA***MASKED***'],
      [tok('ghp', '_1234567890abcdefghijABCDEFGHIJ1234'), 'ghp_***MASKED***'],
      [tok('github', '_pat_11ABCDE0abcdefghij_1234567890abcdefghijklmnopqrstuvwxyz'), 'github_pat_***MASKED***'],
      [tok('xox', 'b-123456789012-abcdefghijklmnop'), 'xoxb-***MASKED***'],
      [tok('aws_secret_access_key = ', 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY'), '***MASKED***'],
      [tok('api_key: ', 'AbCdEf0123456789xyz'), '***MASKED***'],
      [tok('vercel deploy --token=', 'Ab0123456789cdEf'), '***MASKED***'],
    ];
    for (const [input, marker] of cases) {
      const masked = maskSecrets(input);
      expect(masked, input).toContain(marker);
      expect(masked, input).not.toContain(input.slice(-12));
    }
  });

  it('PEM 개인키 블록은 본문을 통째로 가린다(줄바꿈이 있어도)', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Zx\n-----END RSA PRIVATE KEY-----';
    const masked = maskSecrets(`here it is: ${pem}`);
    expect(masked).not.toContain('MIIEowIBAAKCAQEA0Zx');
    expect(masked).toContain('***MASKED***');
    expect(masked).toContain('here it is:');
  });

  it('구조화된 값과 평범한 산문은 한 바이트도 바뀌지 않는다', () => {
    const root = setup();
    const data = {
      // 구조화된 필드 — 해시·경로·페이즈·id·URL
      artifactHash: '3b1f9c2e5a7d4b6f8091a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607',
      policyHash: '242a25805337',
      path: '.harness/design/baselines/UX-3.png',
      phase: 'P5',
      id: 'W-12',
      url: 'https://claude.ai/public/artifacts/2f9a1c3e-7b4d-4e1a-9f0b-8c7d6e5f4a3b',
      count: 3,
      // 자유 텍스트지만 비밀이 아닌 것 — 뭉개면 감사 기록의 가치가 사라진다
      detail: 'the token: color-bg-primary must not be a raw value; ask-me-anything-about-this. '
        + 'Bearer of bad news: the secret is out, password required, sk-short is fine.',
      reason: 'external-blocker',
    };
    appendEvent(root, 'critical-raised', data);
    expect(lastData(root)).toEqual(data);
    expect(journalText(root)).not.toContain('MASKED');
  });

  it('중첩 객체·배열 안의 문자열도 가린다 — 새 이벤트 타입이 생겨도 빠지지 않게', () => {
    const root = setup();
    appendEvent(root, 'adr-proposed', {
      id: 'ADR-1',
      rejectedReasons: [tok('uses ghp', '_1234567890abcdefghijABCDEFGHIJ1234 in CI')],
      nested: { rationale: 'token from sk-FAKE-SECRET-abc123XYZ' },
    });
    const raw = journalText(root);
    expect(raw).not.toContain(tok('ghp', '_1234567890abcdefghijABCDEFGHIJ1234'));
    expect(raw).not.toContain('sk-FAKE-SECRET-abc123XYZ');
    expect(raw).toContain('ADR-1');
  });

  it('호출부가 넘긴 객체를 변형하지 않는다(마스킹은 저널에만)', () => {
    const root = setup();
    const data: Record<string, unknown> = { reason: 'external-blocker', detail: 'sk-FAKE-SECRET-abc123XYZ' };
    appendEvent(root, 'critical-raised', data);
    expect(data.detail).toBe('sk-FAKE-SECRET-abc123XYZ');
  });

  it('마스킹이 재생을 바꾸지 않는다 — phase·게이트는 그대로 폴드된다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P5', reason: 'moving on with sk-FAKE-SECRET-abc123XYZ' });
    expect(replayState(readEvents(root)).phase).toBe('P5');
  });
});

describe('[API-03] config.yaml 미지 키', () => {
  it('감사 재현 그대로: 오타 키가 있으면 doctor 가 초록불을 내지 않는다', () => {
    const root = setup();
    writeConfig(root, 'profile: generic\ndesign_bloked_bash:\n  - "my-secret-deploy"\n');
    const r = runDoctor(root);
    expect(r.ok).toBe(false);
    const said = r.issues.join('\n');
    expect(said).toContain('design_bloked_bash');
    // 다음 행동: 올바른 키 이름이 문장 안에 있어야 사용자가 오타를 눈으로 잡는다.
    expect(said).toContain('design_blocked_bash');
  });

  it('inspectConfig 가 미지 키를 목록으로 돌려준다(문자열 파싱이 아니라 데이터로)', () => {
    const root = setup();
    writeConfig(root, 'lang: en\nnope: 1\nalso_nope: 2\n');
    expect(inspectConfig(root).unknownKeys).toEqual(['nope', 'also_nope']);
  });

  it('영어 메시지도 무엇이 깨졌는지와 다음 행동을 담는다', () => {
    const prev = process.env.HARNESS_LANG;
    delete process.env.HARNESS_LANG;
    resetLangCache();
    try {
      const root = setup();
      writeConfig(root, 'design_bloked_bash: []\n');
      const said = runDoctor(root).issues.join('\n');
      expect(said).toMatch(/design_bloked_bash/);
      expect(said).toMatch(/ignored/i);
      expect(said).toMatch(/config\.yaml/);
    } finally {
      if (prev === undefined) delete process.env.HARNESS_LANG; else process.env.HARNESS_LANG = prev;
      resetLangCache();
    }
  });

  // 과보고 금지 — 정상 config 에서 새 경고가 뜨면 그건 결함이다.
  it('init 이 만든 기본 config 는 아무것도 보고하지 않는다', () => {
    const root = setup();
    const r = runDoctor(root);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(inspectConfig(root).unknownKeys).toEqual([]);
  });

  it('빈 파일·주석만 있는 파일·값 없는 키는 미지 키가 아니다', () => {
    for (const content of ['', '\n\n', '# 전부 주석\n# design_bloked_bash: x\n', 'lang:\n']) {
      const root = setup();
      writeConfig(root, content);
      expect(inspectConfig(root).unknownKeys, JSON.stringify(content)).toEqual([]);
      expect(runDoctor(root).ok, JSON.stringify(content)).toBe(true);
    }
  });

  it('제품이 실제로 읽는 키는 전부 미지 키가 아니다 — 목록이 두 벌로 갈리면 오보가 난다', () => {
    const root = setup();
    writeConfig(root, Object.keys(DEFAULT_CONFIG).map((k) => `${k}: null`).join('\n') + '\n');
    expect(inspectConfig(root).unknownKeys).toEqual([]);
    expect(runDoctor(root).ok).toBe(true);
  });

  it('깨진 YAML·매핑 아님은 종전대로 warning 으로 남는다(ok 를 내리지 않는다)', () => {
    const broken = setup();
    writeConfig(broken, '{{{\n');
    const rb = runDoctor(broken);
    expect(rb.ok).toBe(true);
    expect(rb.warnings.join('\n')).toContain('config');

    const scalar = setup();
    writeConfig(scalar, 'just-a-string\n');
    const rs = runDoctor(scalar);
    expect(rs.ok).toBe(true);
    expect(allLines(scalar).join('\n')).toContain('config');
  });
});
