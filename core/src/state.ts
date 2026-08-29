import * as fs from 'node:fs';
import * as path from 'node:path';
import { harnessDir, statePath, wavesDir, designDir, ledgerPath, configPath, runtimeDir, eventsPath, presence } from './paths';
import type { HarnessState } from './types';
import { tr } from './tr';

/**
 * [SHIP-06] **이 빌드가 아는 상태 스키마 버전.** 정의는 여기 한 벌이다 — `doctor` 도 이 상수를
 * 본다. 손으로 숫자를 두 번 적으면 그 사본이 낡는 순간 「경고는 하는데 막지는 않는」 상태가 된다.
 */
export const SCHEMA_VERSION = 1;

export function defaultState(): HarnessState {
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: 'P0',
    activeWave: null,
    gates: {},
    backtrack: null,
    updatedAt: new Date().toISOString(),
  };
}

export function isInitialized(root: string): boolean {
  return fs.existsSync(statePath(root));
}

/**
 * [OPS-94] **하네스가 걸려 있는가** — `state.json` 이 아니라 `.harness/` 디렉토리로 판정한다.
 *
 * `isInitialized`(state.json 존재)를 「초기화됐는가」로 쓰면 **복구 경로가 막힌다**: state.json 만
 * 지운 상태에서 모든 명령이 「`harness init` 을 먼저 실행하라」고 하고, `init` 은 「이미 있다」고
 * 거부한다. 정작 저널은 멀쩡하고 `doctor --repair` 가 그걸 재생해 복구할 수 있는데, 그 명령까지
 * 같은 가드에 막혀 **막다른 길**이 된다(독립 감정이 실측).
 *
 * 그래서 둘을 나눈다: 「.harness/ 가 있는가」(= 이 프로젝트가 하네스를 쓴다)와
 * 「state.json 이 있는가」(= 파생 상태가 성하다). 앞은 가드가, 뒤는 복구가 본다.
 */
export function hasHarness(root: string): boolean {
  return fs.existsSync(harnessDir(root));
}

/**
 * [UTIL-A2] `state.json` 만 사라진 상태에서 **내부 절대경로가 박힌 raw ENOENT** 를 뱉었다 —
 * 사람은 오류가 가리키는 곳을 고치려 드는데, 그 문구는 「이 경로가 왜 여기 있나」만 남긴다.
 * 이 상태는 **미초기화가 아니라 열화**이고 복구 수단이 실제로 있다(저널 재생).
 *
 * 한 곳에서 고친다 — 명령마다 안내를 복제하면 새 명령이 생길 때마다 빠진다([USE-93]·[OPS-94]가
 * 같은 사고였다). 던지는 것은 그대로 유지한다: `doctor` 는 자기 존재 검사로 이 상태를 잡으므로
 * 복구 경로는 이 문구에 걸리지 않는다.
 */
export function readState(root: string): HarnessState {
  let future: number | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(root), 'utf8')) as HarnessState;
    /**
     * [SHIP-06] **미래 스키마를 조용히 읽고 그 위에 쓰지 않는다.**
     *
     * 예전에는 검사가 `doctor` 한 곳뿐이었고 그것도 `issues` 가 아닌 `warnings` 였다 —
     * **사용자가 `doctor` 를 일부러 돌려야만 보인다.** `status`·`phase set`·`wave …` 그리고
     * **훅**은 전부 무검사 경로를 탔다. 즉 다운그레이드한 사용자는 「새 스키마를 구 코드가
     * 오독한 상태」로 게이트·웨이브 판정을 계속 받으면서, 그 사실을 알려 주는 신호가
     * 명령 흐름 안에 없었다 — 이 축의 게이트가 금지하는 **「조용한 기본값」** 그 자체다.
     *
     * 여기서 던지면 모든 표면이 함께 닫힌다: CLI 는 처방과 함께 종료하고, 훅은 자신의
     * 포괄 catch 로 **열화(degraded)** 로 떨어져 세션 시작 배너가 사용자에게 말한다
     * (무해 계약은 유지 — 세션을 깨지 않는다).
     *
     * 낮은 버전은 막지 않는다 — 그건 마이그레이션이 할 일이고, 구 데이터를 읽는 것은
     * 이 제품이 광고하는 업그레이드 경로다.
     */
    const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
    if (typeof v === 'number' && v > SCHEMA_VERSION) {
      // 아래 catch 는 「손상」 처방(저널 재생)을 주는데, 미래 스키마는 손상이 아니라
      // **버전 불일치**다 — 처방이 다르다. 그래서 catch 를 지나치도록 표시해 둔다.
      future = v;
    }
    if (future === null) return parsed;
    throw new Error('');
  } catch (e) {
    if (future !== null) {
      throw new Error(tr(root, {
        en: `state.json was written by a newer harness (schemaVersion ${future}); this build only knows `
          + `${SCHEMA_VERSION}. Reading it would silently misinterpret gates and waves, and writing `
          + 'over it would lose what the newer build recorded. Upgrade the harness, or move '
          + '`.harness/` aside and start fresh.',
        ko: `state.json 이 더 새 버전의 하네스가 쓴 것이다(schemaVersion ${future}). 이 빌드는 `
          + `${SCHEMA_VERSION} 까지만 안다. 그대로 읽으면 게이트·웨이브를 조용히 오독하고, `
          + '그 위에 쓰면 새 빌드가 기록한 것을 잃는다. 하네스를 업그레이드하거나, '
          + '`.harness/` 를 옆으로 치우고 새로 시작하라.',
      }));
    }
    /**
     * [UX-117] **손상된 상태 파일에도 처방을 준다.** 예전에는 `state.json` 이 깨져 있으면
     * `harness status` 가 `Unexpected token 'g' … is not valid JSON` 만 뱉고 끝났다 —
     * 혼란스러운 순간에 가장 먼저 치는 명령이 원인만 던지고 나가는 길을 안 알려 준 것이다.
     * 파일이 **없는** 경우(아래)와 원인은 다르지만 처방은 같다: 저널이 진실이므로 재생하면 된다.
     */
    if (isInitialized(root)) {
      throw new Error(tr(root, {
        en: `state.json is damaged and could not be parsed (${(e as Error).message}) — the state store is `
          + 'derived, so the event journal can rebuild it: run `harness doctor --repair`. '
          + '`harness doctor` alone reports what it finds without changing anything.',
        ko: `state.json 이 손상돼 해석할 수 없다 (${(e as Error).message}) — 상태 저장소는 파생물이라 `
          + '이벤트 저널로 다시 만들 수 있다: `harness doctor --repair` 를 실행하라. '
          + '`harness doctor` 만 실행하면 아무것도 바꾸지 않고 진단만 한다.',
      }));
    }
    /**
     * [SHIP-07] 「못 읽는다」를 「없다」로 뭉개지 않는다. `chmod 000 .harness` 상태에서 예전에는
     * 「state.json 이 없다 → `doctor --repair`」라고 했는데, 파일은 멀쩡히 있고 `--repair` 도
     * 같은 권한에 막힌다 — 처방이 통하지 않는 막다른 길이었다.
     */
    if (hasHarness(root) && presence(statePath(root)) === 'unreadable') {
      throw new Error(tr(root, {
        en: `state.json cannot be read — this is a permission problem, not a missing file. `
          + `Restore access (\`chmod u+rx ${harnessDir(root)}\` and \`chmod u+r ${statePath(root)}\`), `
          + 'then run `harness doctor`. `--repair` cannot help here: it reads the same files.',
        ko: `state.json 을 읽을 수 없다 — 파일이 없는 것이 아니라 권한 문제다. `
          + `접근 권한을 되돌린 뒤(\`chmod u+rx ${harnessDir(root)}\` · \`chmod u+r ${statePath(root)}\`) `
          + '`harness doctor` 를 실행하라. `--repair` 는 같은 파일을 읽으므로 여기서는 도움이 안 된다.',
      }));
    }
    if (hasHarness(root) && !isInitialized(root)) {
      throw new Error(tr(root, {
        en: '.harness/ is here but state.json is missing — the state store is derived, so the event '
          + 'journal can rebuild it. Run `harness doctor --repair`. Do not run `harness init`: it refuses '
          + 'while .harness/ exists',
        ko: '.harness/ 는 있는데 state.json 이 없다 — 상태 저장소는 파생물이라 이벤트 저널로 다시 '
          + '만들 수 있다. `harness doctor --repair` 를 실행하라. `harness init` 은 .harness/ 가 있으면 '
          + '거부하므로 그쪽이 아니다',
      }));
    }
    throw e;
  }
}

/**
 * [OPS-05] **쓰기 실패는 raw errno 로 새지 않는다.**
 *
 * 읽기전용 `.harness/` 에서 `doctor --repair` 가
 * `EACCES: permission denied, open '<...>/.harness/state.json.tmp-32208'` 를 그대로 뱉었다 —
 * 남는 것은 사람이 본 적 없는 **내부 임시파일 경로**뿐이고, 무엇을 하면 되는지는 없었다.
 * 이 저장소가 다른 곳(UX-117·wave.ts 의 ENOENT 재작성 등)에서 지키는 규율이 여기만 빠져 있었다.
 *
 * 「쓸 수 없는 자리」 계열(EACCES·EPERM·EROFS)만 재작성한다. 나머지 errno 는 그대로 던진다 —
 * 원인이 다른 실패를 권한 문구로 덮으면 사람을 엉뚱한 곳으로 보낸다.
 */
const WRITE_DENIED = new Set(['EACCES', 'EPERM', 'EROFS']);

export function rethrowWriteFailure(root: string, e: unknown, target: string): never {
  const code = (e as NodeJS.ErrnoException).code;
  if (!code || !WRITE_DENIED.has(code)) throw e;
  const dir = path.dirname(target);
  throw new Error(tr(root, {
    en: `Cannot write to ${dir} (${code}) — the harness keeps its state and journal there, so nothing `
      + 'can be recorded while this lasts: gate approvals, wave history and the activity marker are all '
      + `dropped. Check the directory permissions (\`chmod u+w ${dir}\`) or whether the volume is mounted `
      + `read-only, then run \`harness doctor\`. Original error: ${(e as Error).message}`,
    ko: `${dir} 에 쓸 수 없다 (${code}) — 하네스는 상태와 저널을 그 아래에 기록하므로 이 상태가 `
      + '계속되는 동안 아무것도 남지 않는다: 게이트 승인·웨이브 이력·활동 마커가 전부 유실된다. '
      + `디렉토리 권한을 확인하거나(\`chmod u+w ${dir}\`) 볼륨이 읽기전용으로 마운트됐는지 보라. `
      + `그 뒤 \`harness doctor\` 를 돌려라. 원본 오류: ${(e as Error).message}`,
  }));
}

export function writeState(root: string, state: HarnessState): void {
  const target = statePath(root);
  const tmp = `${target}.tmp-${process.pid}`;
  const next = { ...state, updatedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, target); // 같은 디렉토리 내 rename = POSIX 원자적 (내구성은 events.jsonl 재생이 담당)
  } catch (e) {
    rethrowWriteFailure(root, e, target);
  }
}

export function initHarness(root: string): void {
  // 디렉토리 기준 가드: state.json만 사라진 상태에서 재실행하면 events.jsonl(진실의 원천)·
  // config.yaml이 덮여 전멸한다. 훅 비간섭 게이트도 이 디렉토리 기준을 쓴다(hook.ts, LOGIC-11) —
  // 같은 개념에 두 정의를 두지 않는다. isInitialized(state.json 존재)는 status·복구 판정용으로 남는다.
  if (fs.existsSync(harnessDir(root))) throw new Error(tr(root, { en: `.harness/ is already initialised: ${harnessDir(root)}`, ko: `.harness/ 가 이미 초기화되어 있다: ${harnessDir(root)}` }));
  for (const d of [harnessDir(root), designDir(root), wavesDir(root), runtimeDir(root)]) {
    fs.mkdirSync(d, { recursive: true });
  }
  // 세션 스크래치는 커밋 금지. 단 `*` 만 두면 .gitignore 자신도 무시되어 디렉토리가
  // 통째로 커밋에서 빠진다 — 클론하면 .runtime/ 이 없어 훅의 hook-errors.log append 가
  // 조용히 실패한다(로깅은 비간섭 때문에 mkdir 하지 않는다).
  fs.writeFileSync(path.join(runtimeDir(root), '.gitignore'), '*\n!.gitignore\n');
  fs.writeFileSync(ledgerPath(root), 'nodes: []\n');
  fs.writeFileSync(configPath(root), [
    'profile: generic',
    'remote_control: true',
    'terse: false',
    '', ].join('\n'));
  fs.writeFileSync(eventsPath(root), '');
  const tmp = `${statePath(root)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(defaultState(), null, 2) + '\n');
  fs.renameSync(tmp, statePath(root));
}
