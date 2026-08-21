/**
 * UX-24 · API-27 · API-29 · FEAT-22 · FEAT-23 회귀 테스트.
 * 출하 검증 대장의 사용성·효용성 항목을 고정한다.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { COMMANDS, renderHelp, unknownSub, unknownCommand } from '../src/help';
import { loadConfig } from '../src/config';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-help-'));
const capture = () => {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  return { out, text: () => out.join('\n'), restore: () => { l.mockRestore(); e.mockRestore(); } };
};

describe('UX-24: 진입점이 존재한다', () => {
  it('--help·-h·help·무인자가 전부 exit 0 으로 사용법을 낸다', () => {
    const root = tmp();
    for (const argv of [[], ['--help'], ['-h'], ['help']]) {
      const c = capture();
      const code = run(argv, root);
      c.restore();
      expect(code, `argv=${JSON.stringify(argv)}`).toBe(0);
      expect(c.text()).toContain('Usage: harness');
    }
  });

  it('사용법이 13개 이상의 명령군을 **전부** 나열한다', () => {
    const text = renderHelp('en');
    for (const g of COMMANDS) expect(text, `${g.name} 누락`).toContain(`  ${g.name}`);
    expect(COMMANDS.length).toBeGreaterThanOrEqual(13);
  });

  it('명령군별 --help 가 하위명령을 낸다', () => {
    const root = tmp();
    const c = capture();
    expect(run(['gate', '--help'], root)).toBe(0);
    c.restore();
    expect(c.text()).toContain('submit');
    expect(c.text()).toContain('approve');
  });

  it('미지 명령은 exit 1 이되 가능한 명령군을 함께 준다 — 막다른 골목 금지', () => {
    const root = tmp();
    const c = capture();
    expect(run(['nosuchcmd'], root)).toBe(1);
    c.restore();
    expect(c.text()).toContain('nosuchcmd');
    expect(c.text()).toContain('gate');
  });
});

describe('API-27: 하위명령 안내가 모든 군에서 동일하다', () => {
  it('하위명령을 가진 군은 전부 목록을 안내한다 (절반만 안내하던 회귀 방지)', () => {
    for (const g of COMMANDS.filter(g => g.subs?.length)) {
      const msg = unknownSub(g.name, 'zzz', 'en');
      expect(msg, `${g.name}`).toContain('expected one of:');
      for (const s of g.subs!) expect(msg, `${g.name}.${s.name}`).toContain(s.name);
    }
  });

  it('하위명령 누락(undefined)도 같은 안내를 받는다', () => {
    expect(unknownSub('node', undefined, 'en')).toContain('upsert');
    expect(unknownSub('node', undefined, 'ko')).toContain('upsert');
  });
});

describe('i18n: 기본은 영어, lang: ko 로 전환', () => {
  it('기본 config 의 lang 은 en', () => {
    expect(loadConfig(tmp()).lang).toBe('en');
  });

  it('config 의 lang: ko 가 출력을 바꾼다', () => {
    const root = tmp();
    run(['init'], root);
    fs.appendFileSync(path.join(root, '.harness/config.yaml'), '\nlang: ko\n');
    const c = capture();
    run(['--help'], root);
    c.restore();
    expect(c.text()).toContain('사용법: harness');
  });

  it('번역이 없는 자리는 영어로 떨어진다 (깨지지 않는다)', () => {
    // ko 가 비어 있는 Msg 를 흉내 — pick 의 폴백 계약
    expect(unknownCommand('x', 'ko')).toContain('알 수 없는 명령');
    expect(unknownCommand('x', 'en')).toContain('Unknown command');
  });
});

describe('FEAT-22: harness trace', () => {
  it('노드→웨이브→문서를 조인해 돌려준다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'UX-1', '--title', 'login'], root);
    run(['wave', 'create', '--goal', 'g', '--refs', 'UX-1'], root);
    c.out.length = 0;
    expect(run(['trace', 'UX-1'], root)).toBe(0);
    c.restore();
    const parsed = JSON.parse(c.text());
    expect(parsed.node.id).toBe('UX-1');
    expect(parsed.waves).toHaveLength(1);
    expect(parsed.waves[0].design_refs).toContain('UX-1');
  });

  it('없는 노드는 등록 방법을 안내하며 exit 1', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    expect(run(['trace', 'NOPE-1'], root)).toBe(1);
    c.restore();
    expect(c.text()).toContain('node upsert');
  });

  it('인자 누락은 「알 수 없는 명령」이 아니라 사용법이다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    run(['trace'], root);
    c.restore();
    expect(c.text()).toContain('harness trace <node-id>');
    expect(c.text()).not.toContain('Unknown command');
  });
});

describe('FEAT-23: harness gate feedback', () => {
  it('코멘트를 수집해 리뷰 패킷에 개정 근거로 싣는다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    const file = path.join(root, 'comments.txt');
    fs.writeFileSync(file, 'label truncated\ncontrast below AA\n\nmove submit button\n');
    expect(run(['gate', 'feedback', 'P0', '--from', file], root)).toBe(0);
    c.out.length = 0;
    run(['report', 'packet', 'P0'], root);
    c.restore();
    expect(c.text()).toContain('리뷰 피드백');
    expect(c.text()).toContain('label truncated');
    expect(c.text()).toContain('move submit button');
  });

  it('--from 없이 부르면 수집된 것을 보여 준다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    c.out.length = 0;
    run(['gate', 'feedback', 'P0'], root);
    c.restore();
    expect(c.text()).toContain('No review feedback collected');
  });

  it('빈 피드백은 거부된다 — 빈 것은 개정 근거가 아니다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    const file = path.join(root, 'empty.txt');
    fs.writeFileSync(file, '\n\n   \n');
    expect(run(['gate', 'feedback', 'P0', '--from', file], root)).toBe(1);
    c.restore();
  });

  it('수집 내용은 중화된다 — 패킷은 심사자·모델이 읽는 지시 채널이다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    const file = path.join(root, 'evil.txt');
    fs.writeFileSync(file, 'ok comment\u001b[31m with ansi');
    run(['gate', 'feedback', 'P0', '--from', file], root);
    c.out.length = 0;
    run(['report', 'packet', 'P0'], root);
    c.restore();
    expect(c.text()).not.toContain('\u001b');
    expect(c.text()).toContain('ok comment');
  });
});

describe('API-29: 침묵 성공이 없다', () => {
  it('wave create 는 목표 없이 성공하지 않는다', () => {
    const root = tmp();
    const c = capture();
    run(['init'], root);
    const code = run(['wave', 'create'], root);
    c.restore();
    expect(code).toBe(1);
    expect(c.text()).toContain('--goal');
  });
});
