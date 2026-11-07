/**
 * 하네스 소유 파일을 **이름을 적지 않고** 만드는 형태를 찾는다 — 해제 · 상위 폴더 대상 복사 · 폴더 안에서 실행한 쓰기.
 *
 * `judgeWritePath` 는 명령에 적힌 대상을 본다. 그런데 `tar -xf a.tar`, `cp -R /tmp/t/. .` 는
 * `.harness/state.json` 이나 승인 표를 만들면서 그 이름을 적지 않는다. 그 파일들이 게이트 승인을 정하므로
 * 사람의 승인 없이 게이트가 열린다.
 *
 * 프로젝트 루트에 파일을 푸는 일 자체는 평범하다. 그래서 내용을 읽을 수 있는 아카이브는 읽어 보고,
 * `.harness` 가 없으면 통과시킨다. 복사는 결과 경로로 판정한다. 대상을 글자로 읽을 수 없는 형태
 * (`cd "$X"` 뒤의 해제 등)는 판정하지 않는다 — README 「알려진 한계」.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commandSegments, isReadOnlyCommand, type CommandSegment } from './bashwrite';

export interface OwnedTreeHit {
  /** 사람이 읽을 대상(명령에 적힌 그대로). */
  target: string;
  why: 'unpack' | 'unreadable-archive' | 'copy' | 'inside-runtime';
}

const HARNESS_DIR = '.harness';
const RUNTIME_DIR = '.harness/.runtime';
const LIST_TIMEOUT_MS = 3000;
const LIST_MAX_BYTES = 32 * 1024 * 1024;

const fold = (s: string): string => s.toLowerCase().replace(/\/+$/u, '');
const unknown = (w: string): boolean => /[$`]/u.test(w);
const isFlag = (w: string): boolean => w.startsWith('-') && w !== '-';

function real(p: string): string {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

/** 명령의 낱말을 절대 경로로. 글자로 읽을 수 없으면 null. */
function absolute(root: string, seg: CommandSegment, word: string, home: string): string | null {
  if (seg.cwd === null && !word.startsWith('/') && !word.startsWith('~')) return null;
  const w = word.replace(/^\$(?:\{PWD\}|PWD)(?=\/|$)/u, path.join(root, seg.cwd ?? '')).replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/u, home);
  if (unknown(w)) return null;
  return path.resolve(root, seg.cwd ?? '', w);
}

/** `-C dir` · `-Cdir` · `-xC dir` · `--directory=dir` · `--directory dir` 의 값. */
function optionValue(args: string[], short: string, long?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (long && a.startsWith(`--${long}=`)) return a.slice(long.length + 3);
    if (long && a === `--${long}`) return args[i + 1];
    if (a.startsWith('--') || !a.startsWith('-')) continue;
    const at = a.indexOf(short);
    if (at > 0) return a.slice(at + 1) || args[i + 1];
  }
  return undefined;
}

interface Unpack { dest: string; archive?: string; opaque: boolean; list?: string[] }

/** 이 명령이 파일을 풀어 놓는가. 푸는 곳과 내용을 읽는 방법을 돌려준다. */
function unpackOf(seg: CommandSegment): Unpack | null {
  const { name, args } = seg;
  if (name === 'tar' || name === 'bsdtar' || name === 'gtar') {
    const bundled = args[0] !== undefined && !args[0].startsWith('-') && /^[A-Za-z]+$/u.test(args[0]) && args[0].includes('x');
    if (!bundled && !args.some(a => a === '--extract' || a === '--get' || /^-[A-Za-z]*x/u.test(a))) return null;
    const dest = optionValue(args, 'C', 'directory') ?? '.';
    // 옛 표기 `tar xzf a.tar` 는 파일 이름이 다음 낱말이다.
    const archive = bundled && args[0].includes('f') ? args[1] : optionValue(args, 'f', 'file');
    const renames = args.some(a => /^--(?:transform|xform)(?:=|$)/u.test(a) || (a.startsWith('-') && !a.startsWith('--') && a.endsWith('s')));
    return { dest, archive, opaque: renames || archive === undefined || archive === '-', list: ['tar', '-tf'] };
  }
  if (name === 'unzip') {
    const archive = args.find(a => !isFlag(a));
    return { dest: optionValue(args, 'd') ?? '.', archive, opaque: archive === undefined, list: ['unzip', '-Z1'] };
  }
  if (name === 'pax' && args.some(a => /^-[A-Za-z]*r/u.test(a))) return { dest: '.', opaque: true };
  if (name === 'cpio' && args.some(a => a === '--extract' || /^-[A-Za-z]*i/u.test(a))) return { dest: '.', opaque: true };
  if ((name === '7z' || name === '7za' || name === '7zz') && (args[0] === 'x' || args[0] === 'e')) {
    return { dest: args.find(a => a.startsWith('-o'))?.slice(2) || '.', opaque: true };
  }
  return null;
}

/** 아카이브 안에 `.harness` 가 있으면 true. 읽지 못하면 null. */
function archiveHasHarness(file: string, list: string[]): boolean | null {
  try {
    const out = execFileSync(list[0], [...list.slice(1), file], { timeout: LIST_TIMEOUT_MS, maxBuffer: LIST_MAX_BYTES, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    return out.split('\n').some(line => line.split('/').some(part => part.toLowerCase() === HARNESS_DIR));
  } catch { return null; }
}

/** 복사 도구의 목적지와 원본들. `-t dir` 은 목적지를 앞에 둔다(rsync 의 `-t` 는 다른 뜻이다). */
function copyOf(seg: CommandSegment): { dest: string; sources: string[] } | null {
  if (!['cp', 'gcp', 'mv', 'gmv', 'rsync', 'ditto', 'ln', 'gln'].includes(seg.name)) return null;
  const words = seg.args.filter(a => !isFlag(a));
  const named = seg.name === 'rsync' || seg.name === 'ditto' ? undefined : optionValue(seg.args, 't', 'target-directory');
  if (named !== undefined) return { dest: named, sources: words.filter(w => w !== named) };
  if (words.length < 2) return null;
  return { dest: words[words.length - 1], sources: words.slice(0, -1) };
}

/** 이 원본을 이 목적지로 복사하면 소유 파일을 덮을 수 있는가. */
function copyReaches(tool: string, source: string, destAbs: string, covers: (p: string) => boolean): boolean {
  // 원본 이름을 모르면 `.harness` 일 수 있고, `.*` 는 숨은 폴더까지 맞는다. `*` 는 점으로 시작하는 이름에 맞지 않는다.
  if (!covers(destAbs)) {
    const base = path.basename(source.replace(/\/\.?$/u, ''));
    return !/[$`*?[{]/u.test(base) && covers(path.join(destAbs, base));
  }
  if (tool === 'ditto' || /\/\.?$/u.test(source) || source === '.') return true;
  const base = path.basename(source);
  if (unknown(source) || source.toLowerCase().includes(HARNESS_DIR)) return true;
  if (/[*?[{]/u.test(base) && base.startsWith('.')) return true;
  return covers(path.join(destAbs, base));
}

/**
 * 이 명령이 소유 파일을 이름 없이 만들 수 있으면 첫 번째 경우를 돌려준다.
 * @param owned 루트 상대 소유 경로(파일 또는 접두).
 */
export function ownedTreeWrite(
  root: string, owned: readonly string[], cmd: string, env: Record<string, string | undefined>,
): OwnedTreeHit | null {
  const roots = [...new Set([root, real(root)])];
  const ownedAbs = roots.flatMap(r => owned.map(o => fold(path.join(r, o))));
  const runtime = roots.map(r => fold(path.join(r, RUNTIME_DIR)));
  const harness = roots.map(r => fold(path.join(r, HARNESS_DIR)));
  const home = env.HOME ?? '';
  const covers = (p: string): boolean => {
    const check = (c: string): boolean => ownedAbs.some(o => o === c || o.startsWith(`${c}/`));
    return check(fold(p)) || check(fold(real(p)));
  };
  const segments = commandSegments(cmd, env);
  for (const seg of segments) {
    const cwd = seg.cwd === null ? null : fold(path.resolve(root, seg.cwd));
    if (cwd !== null && runtime.some(r => cwd === r || cwd.startsWith(`${r}/`))
      && !['cd', 'pushd', 'popd', 'harness'].includes(seg.name) && !isReadOnlyCommand([seg.name, ...seg.args].join(' '))) {
      return { target: seg.cwd as string, why: 'inside-runtime' };
    }
    const unpack = unpackOf(seg);
    if (unpack) {
      const dest = absolute(root, seg, unpack.dest, home);
      if (dest === null || !covers(dest)) continue;
      // `.harness` 안에 푸는 경우 소유 파일은 이름에 `.harness` 를 달지 않는다. 그래서 내용을 읽어도 소용이 없다.
      if (harness.some(h => fold(dest) === h || fold(dest).startsWith(`${h}/`))) return { target: unpack.dest, why: 'unpack' };
      if (unpack.opaque || !unpack.list || unpack.archive === undefined) return { target: unpack.dest, why: 'unreadable-archive' };
      const archive = absolute(root, seg, unpack.archive, home);
      if (archive === null) return { target: unpack.archive, why: 'unreadable-archive' };
      if (!fs.existsSync(archive)) {
        // 없는 파일을 풀면 tar 가 실패한다. 다만 같은 줄에서 만드는 경우는 내용을 읽을 수 없다.
        if (segments.some(s => s !== seg && s.args.includes(unpack.archive as string))) return { target: unpack.archive, why: 'unreadable-archive' };
        continue;
      }
      const hit = archiveHasHarness(archive, unpack.list);
      if (hit === null) return { target: unpack.archive, why: 'unreadable-archive' };
      if (hit) return { target: unpack.archive, why: 'unpack' };
      continue;
    }
    if (seg.name === 'git' && seg.args[0] === 'clone') {
      const words = seg.args.slice(1).filter(a => !isFlag(a));
      const dest = words.length >= 2 ? words[words.length - 1] : path.basename(words[0] ?? '', '.git');
      const abs = dest ? absolute(root, seg, dest, home) : null;
      if (abs !== null && covers(abs)) return { target: dest, why: 'copy' };
      continue;
    }
    const copy = copyOf(seg);
    if (copy) {
      const dest = absolute(root, seg, copy.dest, home);
      if (dest === null) continue;
      const source = copy.sources.find(s => copyReaches(seg.name, s, dest, covers));
      if (source !== undefined) return { target: `${source} -> ${copy.dest}`, why: 'copy' };
    }
  }
  return null;
}

/** 사람 대신 터미널을 만들거나 입력을 넣는 도구. 이 도구 안에서 승인 명령을 돌리면 CLI 는 사람이 친 것과 구분하지 못한다. */
const RELAY_HEAD_RE = /^(?:\S*\/)?(?:script|expect|unbuffer|socat|tmux|screen|zellij|dtach|abduco|osascript|orca|paseo|wezterm|kitty|kitten)\b/u;
const APPROVE_TEXT_RE = /(?:harness|cli\.js)\b.*\bgate\b|:approve\b/u;
const PTY_INTERPRETER_RE = /\b(?:python\d*(?:\.\d+)?|perl|ruby|node|nodejs)\b[\s\S]*\bpty\b[\s\S]*(?:harness|cli\.js)/u;
/** Claude Code 안임을 알리는 환경 변수를 지운 뒤 하네스를 부르는 형태. */
const CLEARS_MARKER_RE = /(?:\bunset\s+[^;&|\n]*|\benv\b[^;&|\n]*\s-u\s*|(?:^|[\s;&|])-u\s*)(?:CLAUDECODE|CLAUDE_CODE_ENTRYPOINT)\b/u;

/** `script` · `unbuffer` 는 명령 해석에서 접두로 벗겨지므로 원문에서 본다. */
const PTY_PREFIX_RE = /(?:^|[\s;&|(`])(?:\S*\/)?(?:script|unbuffer)\s[^\n;&|]*(?:harness|cli\.js)[^\n;&|]*\bgate\b/u;

/** 승인 입력을 대신 치거나 사람이 있는 척하는 줄이면 그 줄을 돌려준다. */
export function approvalRelay(lines: readonly string[], cmd: string): string | undefined {
  const line = lines.find(l => RELAY_HEAD_RE.test(l) && APPROVE_TEXT_RE.test(l));
  if (line !== undefined) return line;
  if (PTY_INTERPRETER_RE.test(cmd) || PTY_PREFIX_RE.test(cmd)) return cmd;
  return CLEARS_MARKER_RE.test(cmd) && /(?:harness|cli\.js)/u.test(cmd) ? cmd : undefined;
}
