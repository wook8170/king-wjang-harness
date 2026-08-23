import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// 이 스위트는 **기본값 자체**가 대상이라 스위트 전역의 HARNESS_LANG=ko(core/test/setup.ts)를
// 해제하고 본다. 언어 해석 규칙은 help-trace-feedback.test.ts 가 따로 검증한다.
let prevLang: string | undefined;
beforeEach(() => { prevLang = process.env.HARNESS_LANG; delete process.env.HARNESS_LANG; });
afterEach(() => { if (prevLang === undefined) delete process.env.HARNESS_LANG; else process.env.HARNESS_LANG = prevLang; });
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../src/config';
import { isPhase } from '../src/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

const writeConfig = (root: string, content: string) => {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/config.yaml'), content);
};

describe('config', () => {
  it('config.yaml 없으면 기본값', () => {
    expect(loadConfig(tmp())).toEqual(DEFAULT_CONFIG);
  });

  it('부분 설정은 기본값과 병합', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/config.yaml'), 'remote_control: false\n');
    const c = loadConfig(root);
    expect(c.remote_control).toBe(false);
    expect(c.profile).toBe('generic');
  });

  it('YAML 문자열 on/off/yes/no 를 boolean 으로 정규화', () => {
    const root = tmp();
    writeConfig(root, 'remote_control: off\nterse: yes\n');
    const c = loadConfig(root);
    expect(c.remote_control).toBe(false);
    expect(c.terse).toBe(true);
  });

  it('배열 필드가 스칼라(오타)면 기본값 배열로 정규화', () => {
    const root = tmp();
    writeConfig(root, 'design_allowed_prefixes: docs/\n');
    const c = loadConfig(root);
    expect(c.design_allowed_prefixes).toEqual(DEFAULT_CONFIG.design_allowed_prefixes);
  });

  it('깨진 YAML 이면 throw 없이 기본값 반환', () => {
    const root = tmp();
    writeConfig(root, '{{{\n');
    expect(loadConfig(root)).toEqual(DEFAULT_CONFIG);
  });

  it('배열 필드 재정의는 병합이 아니라 교체', () => {
    const root = tmp();
    writeConfig(root, "design_blocked_bash: ['x']\n");
    const c = loadConfig(root);
    expect(c.design_blocked_bash).toEqual(['x']);
  });

  it('반환된 배열은 DEFAULT_CONFIG 와 다른 참조', () => {
    const c = loadConfig(tmp());
    expect(c.design_allowed_prefixes).not.toBe(DEFAULT_CONFIG.design_allowed_prefixes);
    expect(c.design_blocked_bash).not.toBe(DEFAULT_CONFIG.design_blocked_bash);
  });
});

describe('isPhase', () => {
  it('유효한 phase 는 true', () => {
    expect(isPhase('P0')).toBe(true);
    expect(isPhase('P12')).toBe(true);
  });

  it('무효한 값은 false', () => {
    expect(isPhase('P13')).toBe(false);
    expect(isPhase('')).toBe(false);
    expect(isPhase('p0')).toBe(false);
  });
});
