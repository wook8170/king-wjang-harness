/**
 * 정책 무결 [OPS-76] — **판정 규칙이 바뀐 사실을 보이게 만든다.**
 *
 * SEC-69 가 정책 파일(`.harness/config.yaml` + `.harness/profile/`)을 상태 파일과 같은 등급으로
 * 올려 에이전트의 쓰기를 막았다. 사람이 터미널에서 직접 고치는 것은 **의도된 탈출구**로 남았다.
 * 남은 구멍은 **탐지**였다: 사람이 정책을 바꿔도 `doctor` 는 exit 0 · issues 0 이라, 리뷰어가
 * 「왜 이 프로젝트는 설계 트랙에서 소스를 쓸 수 있나」를 물었을 때 답이 어디에도 없었다.
 *
 * 그래서 게이트 산출물 해시(`gate.ts` 의 `artifactHash`)와 **같은 패턴**을 쓴다:
 * 한 시점의 해시를 저널에 고정하고, 이후 대조해 어긋나면 보고한다.
 *
 * ## 설계 결정 셋
 *
 * (1) **언제 고정하나 — init 과 명시적 수용(`doctor --accept-policy`) 두 곳뿐이다.**
 *     게이트 승인 시점에 재고정하지 **않는다**: 승인 다이얼로그의 클릭은 «이 산출물을
 *     심사했다»는 뜻이지 «정책 변경을 승인한다»가 아니다. 거기서 재고정하면 무관한 클릭에
 *     정책 변경이 세탁돼 들어간다. 대신 `gate-approved` 이벤트에 그때의 정책 해시를 **찍기만**
 *     한다 — 「이 게이트는 어떤 정책 아래에서 열렸나」는 나중에 답할 수 있어야 한다.
 *
 * (2) **무엇을 해시하나 — 파일 바이트다.** 파싱한 «유효 정책»이 아니라 원문이다. `loadConfig` 는
 *     환경변수(`HARNESS_LANG`)를 얹으므로 머신마다 값이 달라져 베이스라인이 될 수 없고,
 *     YAML 파싱 실패는 조용히 기본값으로 떨어져 오히려 변경을 숨긴다. 대가는 `lang:` 같은
 *     취향 항목 변경도 경고를 부른다는 것 — 그러나 그건 **보호 대상 파일이 실제로 바뀐 것**이
 *     맞고, 정산은 한 명령(`doctor --accept-policy`)이다. 「보이게」가 목표이므로 이 쪽으로 튼다.
 *
 * (3) **어디에 고정하나 — 저널이다.** `HarnessState` 를 넓히지 않는다. 게이트가 심사 경로를
 *     state 가 아니라 `gate-submitted` 이벤트에 두는 것과 같은 선택이다(gate.ts 헤더) —
 *     이벤트가 진실이고 state 는 파생 캐시다. 정책 해시는 재생 상태를 바꾸지 않으므로
 *     `REPLAY_TYPES` 에는 들어가지 않는다. 단 `EVENT_TYPES` 등록은 **필수**다: 빠지면 doctor 가
 *     「미지 이벤트 → 재생 불신」으로 판정해 `doctor --repair` 가 복구를 거부한다(과거 사고).
 *
 * 순수성: 시각·난수 없음. 같은 파일 상태면 같은 해시다.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendEvent, readEvents } from './events';

/**
 * 판정의 입력이 되는 정책 파일. **hook.ts 의 쓰기 보호 목록이 여기서 나온다** —
 * 「막는 목록」과 「감시하는 목록」이 갈리면, 감시되지 않는 정책 파일이나 보호되지 않는
 * 감시 대상이 생긴다. 둘 중 느슨한 쪽이 정본이 되는 것이 이 저장소가 반복해 겪은 사고다.
 */
export const POLICY_FILES: readonly string[] = ['.harness/config.yaml'];

/** 프로젝트 로컬 프로파일 디렉토리 — 번들 프로파일보다 우선하므로 정책과 같은 무게다. */
export const POLICY_PREFIXES: readonly string[] = ['.harness/profile/'];

export interface PolicySnapshot {
  /** 정책 파일 집합의 SHA-256. */
  hash: string;
  /** 해시에 들어간 파일들(루트 상대 posix, 정렬). */
  files: string[];
}

export interface PolicyPin extends PolicySnapshot {
  ts: string;
  /** 'init' = 초기화 시 자동 고정, 'accept' = 사람이 `doctor --accept-policy` 로 수용. */
  via: string;
}

/** 디렉토리를 재귀로 훑어 루트 상대 파일 경로를 모은다. 심링크는 담지 않는다(아래 주석). */
function collect(root: string, dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 없거나 못 읽는 디렉토리는 «파일 없음» 과 같다 — 목록이 곧 해시의 일부다
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    // Dirent 는 lstat 기준이라 심링크는 isFile()·isDirectory() 가 모두 false 다 — 그대로
    // 건너뛴다. 정책 파일을 심링크로 바꿔치기하면 목록에서 빠져 **해시가 달라지므로**
    // 드리프트로 잡힌다. 따라가지 않는 쪽이 안전한 방향이다.
    if (e.isDirectory()) collect(root, p, out);
    else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join('/'));
  }
}

/** 지금 존재하는 정책 파일 목록. 정렬해 반환한다 — 순서에 해시가 의존하면 안 된다. */
export function listPolicyFiles(root: string): string[] {
  const out: string[] = [];
  for (const rel of POLICY_FILES) {
    try {
      if (fs.statSync(path.join(root, rel)).isFile()) out.push(rel);
    } catch { /* 부재 = 목록에 없음 */ }
  }
  for (const pre of POLICY_PREFIXES) collect(root, path.join(root, pre), out);
  return [...new Set(out)].sort();
}

/**
 * 정책 파일 집합의 SHA-256. 계산 규칙은 `gate.ts` 의 `computeArtifactHash` 와 같다 —
 * 경로·길이·내용 사이에 구분자를 넣어, 서로 다른 파일 조합이 같은 바이트열이 되지 않게 한다.
 */
export function computePolicyHash(root: string): PolicySnapshot {
  const files = listPolicyFiles(root);
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    let content: Buffer | null = null;
    try { content = fs.readFileSync(path.join(root, rel)); } catch { content = null; }
    if (content === null) {
      // 읽기 실패(권한 등)를 «내용 없음»으로 뭉개면 빈 파일과 구분되지 않는다.
      h.update(`${rel}\0unreadable\0`);
      continue;
    }
    h.update(`${rel}\0${content.length}\0`);
    h.update(content);
  }
  return { hash: h.digest('hex'), files };
}

/** 저널에 고정된 최신 베이스라인. 없으면 null(= OPS-76 이전에 만들어진 프로젝트). */
export function pinnedPolicy(root: string): PolicyPin | null {
  const events = readEvents(root);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'policy-pinned') continue;
    const hash = ev.data.hash;
    if (typeof hash !== 'string' || !hash) continue; // 형태 불량은 고정으로 치지 않는다
    const files = Array.isArray(ev.data.files)
      ? ev.data.files.filter((f): f is string => typeof f === 'string')
      : [];
    return { hash, files, ts: ev.ts, via: typeof ev.data.via === 'string' ? ev.data.via : '' };
  }
  return null;
}

export interface PinResult extends PolicySnapshot {
  /** 직전 베이스라인. 처음 고정이면 null. */
  prevHash: string | null;
  /** 실제로 저널에 남겼는가. 같은 해시를 다시 찍는 것은 잡음일 뿐이다. */
  changed: boolean;
}

/**
 * 정책을 지금 상태로 고정한다. 같은 해시면 **저널을 늘리지 않는다** — 반복 실행이 저널을
 * 부풀리면 진짜 변경이 묻힌다. 직전 해시를 함께 남기는 것은 감사 대상이 「무엇이 무엇으로
 * 바뀌었나」이기 때문이다.
 */
export function pinPolicy(root: string, via: 'init' | 'accept'): PinResult {
  const snap = computePolicyHash(root);
  const prev = pinnedPolicy(root);
  const changed = prev === null || prev.hash !== snap.hash;
  if (changed) {
    appendEvent(root, 'policy-pinned', {
      hash: snap.hash, files: snap.files, via, prevHash: prev?.hash ?? null,
    });
  }
  return { ...snap, prevHash: prev?.hash ?? null, changed };
}
