/**
 * doctor — 무결성 검사·재생 복구.
 *
 * 두 축을 분리한다:
 *   issues   = state.json 이 이벤트 재생과 발산한 것. 복구(repair) 대상이자 ok 판정 기준.
 *   warnings = 저널 건강·환경 진단 + 정책 드리프트(OPS-76). 복구로 고쳐지지 않으므로 ok 를
 *              내리지 않는다 — 버전 스큐로 정상 발생하는 미지 이벤트나, 사람이 정당하게 바꾼
 *              정책이 영구 red 를 만들면 경보가 죽는다.
 *
 * 재생 신뢰도(trustworthy)는 복구 게이트일 뿐 ok 와 무관하다. 손상뿐 아니라 저널 부재·
 * 절단 의심도 불신으로 친다 — "증거 없음"은 "아무 일 없었다는 증거"가 아니다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { harnessDir, statePath, eventsPath, designDir, wavesDir, wavePath, runtimeDir, presence, ledgerPath } from './paths';
import { READ_CAPS, READ_WARN_RATIO } from './validate';
import { listAdrs } from './adr';
import { loadLedger } from './ledger';
import { readJournal, replayState, appendEvent, KNOWN_EVENT_TYPES } from './events';
import { tr } from './tr';
import { readWave, listWaves } from './wave';
import type { Msg } from './i18n';
import { readState, writeState, defaultState } from './state';
import { inspectConfig, KNOWN_CONFIG_KEYS } from './config';
import { computePolicyHash, pinnedPolicy, pinPolicy } from './policy';
import type { HarnessEvent, HarnessState } from './types';

export interface DoctorReport {
  /**
   * **수리 후** 기준으로 깨끗한가.
   *
   * [UX-121] 예전에는 수리 **전**에 모은 `issues` 로 계산해서, 성공한 복구가
   * `repaired: true` + `ok: false` + "state.json is damaged" 를 동시에 찍었다 —
   * 청정 여부를 알려면 사람이 같은 명령을 한 번 더 돌려야 했다. 진단 도구가 자기 작업의
   * 결과를 안 알려 주면, 그 도구를 쓰는 사람은 매번 두 번 돌린다.
   */
  ok: boolean;
  repaired: boolean;
  refused: boolean;
  /** 발견한 문제 — **수리 전** 상태다. 무엇이 어긋나 있었는지가 보고의 본체이므로 지우지 않는다. */
  issues: string[];
  /** 수리했을 때 **남은** 문제. 비어 있으면 복구가 끝난 것이다(`repaired` 가 false 면 `undefined`). */
  remaining?: string[];
  warnings: string[];
  notes: string[];
}

/** 비교 범위 = 덮어쓰기 범위. 한쪽만 넓으면 감지 못 한 채 날아가는 필드가 생긴다. */
const COMPARED_FIELDS = ['phase', 'activeWave', 'gates', 'backtrack'] as const;

/** writeState 의 잔해만 고른다 — 숫자 pid 접미사가 아니면 사용자 파일이다. */
const TMP_RE = /\.tmp-(\d+)$/;

function pidAlive(pid: number): boolean {
  if (pid <= 0) return true; // 0·음수는 프로세스 그룹 시그널 — 판정하지 않고 보존한다
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 남의 소유지만 살아 있다. ESRCH 만 죽은 것으로 친다.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 죽은 pid 의 tmp 잔해만 치운다 — 살아있는 프로세스가 쓰는 중일 수 있다. */
function sweepOrphanTmp(root: string): number {
  let swept = 0;
  for (const dir of [harnessDir(root), designDir(root), wavesDir(root)]) {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const m = TMP_RE.exec(name);
      if (!m || pidAlive(Number(m[1]))) continue;
      const p = path.join(dir, name);
      try {
        if (!fs.statSync(p).isFile()) continue;
        fs.rmSync(p);
        swept++;
      } catch {
        // 경합·권한 실패가 진단 전체를 막지는 않는다
      }
    }
  }
  return swept;
}

/**
 * [OPS-04] **`.harness/` 에 지금 쓸 수 있는가** — 내용만 읽어서는 알 수 없는 것.
 *
 * 예전 doctor 는 전부 `readdirSync`/`readFileSync`/`existsSync` 였다. 그래서 `.harness/` 가
 * 읽기전용이 된 프로젝트에서 `{"ok":true,"issues":[]}` 를 냈다 — 진단이 가장 필요한 순간에
 * 초록불이다. 쓰기 불능은 이 제품에서 단순 고장이 아니라 **강제가 꺼진 상태**다: 활동
 * 마커(runtime.ts OPS-03)도, 훅 실패 로그도, 게이트·웨이브 이벤트도 전부 이 아래에 쓴다.
 *
 * 없는 디렉토리는 만들지 않는다 — `doctor` 는 「아무것도 바꾸지 않는 진단」이고, 신규 클론의
 * `.runtime/` 부재는 훅이 첫 활동에 만드는 정상 상태다(쓰기 불능이 아니다).
 */
function unwritableDirs(root: string): string[] {
  const bad: string[] = [];
  for (const dir of [harnessDir(root), runtimeDir(root)]) {
    if (!fs.existsSync(dir)) continue;
    // 이름은 sweepOrphanTmp 의 규칙(`.tmp-<pid>`)을 따른다 — 쓰기와 삭제 사이에 프로세스가
    // 죽어 잔해가 남아도 `.harness/` 쪽은 다음 doctor 가 이미 있는 손으로 치운다.
    // 새 청소 규칙을 만들지 않는다(`.runtime/` 은 gitignore 된 세션 스크래치라 그대로 둔다).
    const probe = path.join(dir, `write-probe.tmp-${process.pid}`);
    try {
      fs.writeFileSync(probe, '');
      fs.rmSync(probe);
    } catch {
      bad.push(dir);
    }
  }
  return bad;
}

function countHookErrors(root: string): number {
  const p = path.join(runtimeDir(root), 'hook-errors.log');
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length;
}

const isPristine = (s: HarnessState): boolean => {
  const d = defaultState();
  return COMPARED_FIELDS.every((f) => JSON.stringify(s[f]) === JSON.stringify(d[f]));
};

export function runDoctor(
  root: string, opts: { repair?: boolean; force?: boolean; acceptPolicy?: boolean } = {},
): DoctorReport {
  // 진단 문자열은 사용자가 읽는 출력이다 — 줄마다 config 를 다시 읽지 않도록 한 번만 해석한다.
  const t = (m: Msg): string => tr(root, m);
  const issues: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  // 0. 쓰기 가능 여부 — 이것이 아니면 아래 진단 전부가 「기록되지 않는 상태」의 사진이다.
  //    비간섭: `.harness/` 가 없으면 손대지 않는다(하네스 미사용 프로젝트).
  //
  //    **왜 warning 이 아니라 issue 인가.** 이 파일 머리말의 분류는 「issues = 복구 대상」이고
  //    쓰기 불능은 재생으로 못 고친다. 그래도 issue 로 올리는 이유는, warnings 가 ok 를
  //    내리지 않기 때문이다 — 정책 드리프트처럼 **정당할 수 있는** 상태와 달리 쓰기 불능은
  //    정당한 정상 상태가 아니고, 바로 이 상태에서 초록불을 내는 것이 OPS-04 의 결함 자체였다.
  //    `--repair` 는 이 issue 를 고치려다 실패하는데, 그 실패도 이제 처방이 붙은 문장이다
  //    (OPS-05, state.ts 의 rethrowWriteFailure).
  if (fs.existsSync(harnessDir(root))) {
    const unwritable = unwritableDirs(root);
    if (unwritable.length > 0) {
      issues.push(t({
        en: `cannot write to ${unwritable.join(', ')} — the harness records everything there, so the `
          + 'activity marker, the hook error log and every gate/wave event are being dropped silently, '
          + 'and the enforcement that depends on the marker (the turn-log settlement guard at session end) '
          + `is off. Fix the permissions (\`chmod u+w ${unwritable[0]}\`) or remount the volume `
          + 'read-write, then run `harness doctor` again.',
        ko: `${unwritable.join(', ')} 에 쓸 수 없다 — 하네스는 모든 것을 그 아래에 기록하므로 `
          + '활동 마커·훅 오류 로그·게이트/웨이브 이벤트가 전부 조용히 유실되고, 마커에 기대는 '
          + '강제(세션 종료 시 턴 로그 정산 가드)가 꺼진다. '
          + `권한을 고치거나(\`chmod u+w ${unwritable[0]}\`) 볼륨을 쓰기 가능으로 다시 마운트한 뒤 `
          + '`harness doctor` 를 다시 돌려라.',
      }));
    }
  }

  // 1. 저널 재생
  const journalExists = fs.existsSync(eventsPath(root));
  /**
   * [USE-01] **저널을 못 읽는 것도 진단 결과다 — 진단기의 크래시가 아니라.**
   *
   * `readJournal` 이 가드 없이 1단계에 있어서, `events.jsonl` 의 권한이 사라진 운영 사고에서
   * `harness doctor` 가 raw EACCES + exit 1 로 죽었다. README 가 그 사고의 **첫 명령**으로
   * 지목하는 도구가 정작 그 사고를 보고하지 못했고, JSON 계약(ok/issues/warnings)까지 깨져
   * 이 출력을 파싱하는 쪽(readiness-auditor·스크립트)이 빈 stdout 으로 함께 실패했다.
   * 바로 아래 state.json 처리는 같은 부류를 이미 구조화된 issue 로 바꾸고 있었다 — 모양을 맞춘다.
   */
  let events: HarnessEvent[] = [];
  let corruptLines = 0;
  let journalReadable = true;
  try {
    ({ events, corruptLines } = readJournal(root));
  } catch (e) {
    journalReadable = false;
    issues.push(t({
      en: `events.jsonl cannot be read (${(e as Error).message}) — the journal is the source of truth, `
        + 'so there is nothing to check the state against. Restore read access to the file '
        + `(\`chmod u+r ${eventsPath(root)}\`), then run \`harness doctor\` again.`,
      ko: `events.jsonl 을 읽을 수 없다 (${(e as Error).message}) — 저널이 진실의 원천이라 `
        + '상태를 대조할 근거가 없다. 파일 읽기 권한을 복구한 뒤'
        + `(\`chmod u+r ${eventsPath(root)}\`) \`harness doctor\` 를 다시 돌려라.`,
    }));
  }
  const replayed = replayState(events);

  // 2. state 읽기
  let current: HarnessState | null = null;
  const statePresence = presence(statePath(root));
  if (statePresence === 'unreadable') {
    // [SHIP-07] 권한을 「없음」으로 뭉개면 처방이 `--repair` 가 되는데, 그것도 같은 파일을
    // 읽으므로 실패한다. 원인을 그대로 말하고 그에 맞는 처방을 준다.
    issues.push(t({
      en: `state.json cannot be read (permission) — restore access with \`chmod u+r ${statePath(root)}\`; `
        + '`--repair` reads the same file and cannot help',
      ko: `state.json 을 읽을 수 없다(권한) — \`chmod u+r ${statePath(root)}\` 로 접근을 되돌려라. `
        + '`--repair` 는 같은 파일을 읽으므로 도움이 안 된다',
    }));
  } else if (statePresence === 'absent') {
    issues.push(t({
      en: 'state.json is missing — it must be rebuilt by replaying the journal',
      ko: 'state.json 이 없다 — 이벤트 재생으로 복구 필요',
    }));
  } else {
    try {
      const parsed = readState(root) as unknown;
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      current = parsed as HarnessState;
    } catch {
      issues.push(t({ en: 'state.json is damaged — cannot parse', ko: 'state.json 손상 — 파싱 불가' }));
    }
  }

  // 3. 저널 건강 → warnings + 재생 신뢰도
  let trustworthy = true;
  // 못 읽은 저널의 재생 결과는 «빈 저널»과 구별되지 않는다 — 그것으로 복구하면 state 를 지운다.
  if (!journalReadable) trustworthy = false;
  if (!journalExists) {
    warnings.push(t({
      en: 'events.jsonl is missing — there is no evidence to replay',
      ko: 'events.jsonl 부재 — 재생할 증거가 없다',
    }));
    trustworthy = false;
  }
  if (corruptLines > 0) {
    warnings.push(t({
      /**
       * [USE-03] **`--repair` 가 못 고치는 것임을 말한다.**
       *
       * 경고 자체는 정확했지만 「무엇을 하면 사라지는가」를 안 적었다. 운영자가 `--repair` 를
       * 「복구」로 기대하고 돌리면 state 는 재생되지만 **저널 줄은 그대로**라 같은 경고가
       * 영속한다 — 「내가 뭘 잘못했나」로 무한 루프에 빠진다. 저널이 append-only 이고
       * 압축·재작성이 없다는 것은 README 가 광고하는 설계이지 고장이 아니다.
       */
      en: `${corruptLines} line(s) of events.jsonl are corrupt — the replay is incomplete. `
        + '`--repair` will not clear this: it rebuilds state.json from the journal and never rewrites '
        + 'the journal itself (append-only by design, see "Known limits"). The state is already '
        + 'corrected by replay, so the harness keeps working; the warning stays as the record that '
        + 'those entries are unreadable. To remove it, a human must edit or archive events.jsonl '
        + 'themselves — that is a deliberate act on the audit trail, not a repair.',
      ko: `events.jsonl ${corruptLines}줄 손상 — 재생 불완전. `
        + '`--repair` 로는 사라지지 않는다: 저널에서 state.json 을 다시 만들 뿐, **저널 자체는 '
        + '고쳐 쓰지 않는다**(append-only 설계 — README 「알려진 한계」). 상태는 이미 재생으로 '
        + '보정돼 하네스는 계속 돈다. 이 경고는 그 줄들을 읽을 수 없다는 **기록**으로 남는 것이다. '
        + '지우려면 사람이 직접 events.jsonl 을 편집하거나 보관해야 한다 — 그것은 복구가 아니라 '
        + '감사 기록에 대한 의도적 조치다.',
    }));
    trustworthy = false;
  }
  const unknown = events.filter((e) => !KNOWN_EVENT_TYPES.has(e.type));
  if (unknown.length > 0) {
    const types = [...new Set(unknown.map((e) => e.type))].join(', ');
    warnings.push(t({
      en: `${unknown.length} event(s) of unknown type (${types}) — the replay result is untrustworthy `
        + '(possible version skew)',
      ko: `미지 이벤트 타입 ${unknown.length}건(${types}) — 재생 결과 불신(버전 스큐 가능)`,
    }));
    trustworthy = false;
  }
  if (journalExists && events.length === 0 && current && !isPristine(current)) {
    warnings.push(t({
      en: 'the journal is empty but state shows progress — suspect truncation',
      ko: '저널이 비어 있으나 state 는 진행 상태 — 절단 의심',
    }));
    trustworthy = false;
  }

  // 4. state 발산 → issues (복구 대상)
  if (current) {
    for (const field of COMPARED_FIELDS) {
      const a = JSON.stringify(current[field]);
      const b = JSON.stringify(replayed[field]);
      if (a !== b) {
        issues.push(t({
          en: `${field} mismatch: state=${a}, journal replay=${b}`,
          ko: `${field} 불일치: state=${a}, 이벤트 재생=${b}`,
        }));
      }
    }
  }

  // 5. activeWave 가 가리키는 웨이브 파일 — 없으면 지시 대상이 사라진 것.
  //    warning 으로 두면 complete/update/activate 가 전부 ENOENT 로 죽는데 복구 수단이
  //    없어진다(state.json 직접 편집은 훅이 막는다). issue 로 올려 repair 의 대상으로 삼는다.
  const effective = current ?? replayed;
  if (effective.activeWave && !fs.existsSync(wavePath(root, effective.activeWave))) {
    issues.push(
      tr(root, {
        en: `The wave file for activeWave ${effective.activeWave} is missing — it may be temporarily absent `
          + '(a git branch switch, say), so restoring the file comes first. If it really is lost, settle '
          + 'activeWave to null with `harness doctor --repair`',
        ko: `activeWave ${effective.activeWave} 의 웨이브 파일 부재 — `
          + 'git 브랜치 전환 등으로 일시 부재일 수 있으니 파일 복원이 우선이다. '
          + '정말 유실이면 `harness doctor --repair` 로 activeWave 를 정산(null)하라',
      }),
    );
  } else if (effective.activeWave) {
    /**
     * [LOGIC-02] **있는데 깨진 지시서는 부재보다 나쁘다 — 아무도 안 봤다.**
     *
     * 웨이브 지시서는 이 제품이 스스로 밝힌 **저널·git 백업이 없는 유일한 파일**이고
     * (`wave.ts` 머리), `.harness/` 아래는 README 가 「언제나 쓸 수 있다」고 광고하므로
     * 에이전트가 `Write` 로 통째로 덮을 수 있다. 그러면 턴 로그·완료기준·design_refs 가
     * 복구 불가로 사라지고 웨이브는 **완료 불능**이 된다(`activate` 가 「Malformed wave file」로 죽는다).
     *
     * 그런데 `doctor` 는 **부재만** 봤다 — 파일이 있으면 통과였다. 즉 가장 조용한 데이터
     * 손실 경로가 진단의 사각이었다.
     *
     * **쓰기를 막지 않는다.** 막으면 광고(`.harness/` 는 언제나 쓸 수 있다)를 함께 고쳐야 하고,
     * 그건 사람이 정할 일이다. 대신 **손실을 관측 가능하게** 만든다 — 부재와 같은 처방
     * (`--repair` 로 activeWave 정산)이 그대로 듣는다.
     */
    try {
      readWave(root, effective.activeWave);
    } catch (e) {
      issues.push(
        tr(root, {
          en: `The wave file for activeWave ${effective.activeWave} exists but cannot be parsed `
            + `(${(e as Error).message}) — a wave sheet has no journal or git backup, so an overwrite `
            + 'loses its turn log and acceptance criteria for good. Restore the file from your editor '
            + 'or VCS if you can; otherwise settle activeWave to null with `harness doctor --repair` '
            + 'and open a new wave.',
          ko: `activeWave ${effective.activeWave} 의 웨이브 파일이 있지만 해석할 수 없다 `
            + `(${(e as Error).message}) — 웨이브 지시서는 저널·git 백업이 없는 유일한 파일이라 `
            + '덮어쓰면 턴 로그와 완료기준이 영구히 사라진다. 편집기나 VCS 로 복원할 수 있으면 '
            + '그것이 우선이고, 아니면 `harness doctor --repair` 로 activeWave 를 정산(null)한 뒤 '
            + '새 웨이브를 열어라.',
        }),
      );
    }
  }

  // 5b. 스키마 버전 — 미래 버전이 쓴 state 를 구 코드가 조용히 읽으면 다운그레이드가
  //     오독한다. 지금은 v1 하나뿐이라 잠재 결함이지만, 경고가 없으면 갈리는 순간을 놓친다.
  if (current && current.schemaVersion !== 1) {
    warnings.push(
      tr(root, {
        en: `state.json schemaVersion is ${String(current.schemaVersion)}, but this build only knows 1 — `
          + 'it was probably written by a newer harness. Upgrade, or the state may be misread.',
        ko: `state.json 의 schemaVersion 이 ${String(current.schemaVersion)} 인데 이 빌드는 1 만 안다 — `
          + '더 새 버전의 하네스가 쓴 파일일 수 있다. 업그레이드하지 않으면 상태를 오독한다.',
      }),
    );
  }

  /**
   * [API-10] **상한에 «닿기 전에» 말한다.** 읽기 상한은 `validate.ts` 가 강제하지만, 그것만
   * 있으면 사람은 어느 날 갑자기 「읽을 수 없다」를 만난다 — 그때는 이미 훅이 느려진 뒤다.
   * 관측되지 않는 한계는 한계가 아니다(이 리포의 [OPS-02]·[SEC-13] 이 같은 교훈이다).
   *
   * 회전·압축은 하지 않는다: 저널은 감사 추적이고 `doctor --repair` 의 유일한 복원원이라,
   * 오래된 줄을 지우거나 옮기면 그 두 성질이 함께 깨진다. 그래서 **사람에게 말한다.**
   */
  for (const [file, cap, what] of [
    [eventsPath(root), READ_CAPS.JOURNAL, 'the event journal (.harness/events.jsonl)'],
    [ledgerPath(root), READ_CAPS.LEDGER, 'the design ledger'],
  ] as const) {
    let size = 0;
    try { size = fs.statSync(file).size; } catch { continue; }
    if (size <= cap * READ_WARN_RATIO) continue;
    const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)}MB`;
    warnings.push(tr(root, {
      en: `${what} is ${mb(size)}, past half of this build's ${mb(cap)} read cap. Every harness call and `
        + 'every hook reads it, and the hook has a 10s budget. Archive it yourself (move it aside and keep '
        + 'it — it is the audit trail, so nothing deletes it for you), then run `harness doctor --repair`.',
      ko: `${what} 크기가 ${mb(size)} 로 이 빌드의 읽기 상한 ${mb(cap)} 의 절반을 넘었다. 모든 harness `
        + '호출과 훅이 이것을 읽고, 훅에는 10초 예산이 있다. 직접 보관하라(옆으로 옮겨 두고 남긴다 — '
        + '감사 추적이라 아무도 대신 지우지 않는다). 그 뒤 `harness doctor --repair` 를 실행하라.',
    }));
  }

  // 6. 고아 tmp 스윕 — 죽은 pid 것만이라 항상 안전하게 수행한다
  const swept = sweepOrphanTmp(root);
  if (swept > 0) {
    notes.push(t({ en: `swept ${swept} orphaned temp file(s)`, ko: `고아 임시파일 ${swept}개 정리` }));
  }

  // [UX-151] 6b. 깨진 config 는 조용히 기본값으로 폴백한다(훅 무해 계약) — 그 사실을 여기서 알린다.
  //     사용자가 적어 둔 정책이 안 걸린 채 도는 것보다, 안 걸린 줄 모르는 것이 나쁘다.
  const cfg = inspectConfig(root);
  for (const problem of cfg.problems) {
    warnings.push(t({
      en: `config could not be parsed, so defaults are in effect — ${problem}`,
      ko: `config 를 해석할 수 없어 기본값으로 동작 중이다 — ${problem}`,
    }));
  }

  // [API-03] 6c. 미지 키 = **사용자가 적어 둔 차단이 존재하지 않는 상태.**
  //
  //   무엇이 깨져 있었나: `design_bloked_bash`(오타) 를 적으면 그 목록은 조용히 버려지고
  //   기본값이 돌았다. 훅은 사용자가 막으려던 명령을 통과시키는데, 유일한 신호는 정책
  //   드리프트 경고 한 줄(「정당한 변경일 수 있다」)뿐이라 **안내가 오히려 안심시켰다.**
  //
  //   **왜 warning 이 아니라 issue(ok:false) 인가.** 이 파일 머리말의 분류는 「issues = 재생
  //   복구 대상」이고 미지 키는 재생으로 못 고친다 — 그래도 issue 로 올린다. 판단 근거는
  //   OPS-04(쓰기 불능)에서 이미 쓴 것과 같다: **정당할 수 있는 상태가 아니다.**
  //   정책 드리프트는 사람이 의도적으로 바꾼 결과일 수 있어 영구 red 가 경보를 죽이지만,
  //   미지 키는 오타이거나 다른 버전의 잔재이며 두 경우 다 「이 파일에 효과 0 인 줄이 있다」로
  //   똑같이 참이다. 그리고 이 파일은 **훅이 무엇을 막을지 정하는 판정의 입력**이다 —
  //   바로 그 상태에서 초록불을 내는 것이 API-03 결함 자체였다. 복구는 하지 않는다:
  //   doctor 가 사용자의 config 를 고쳐 쓰면 SEC-69 가 남긴 「사람의 탈출구」를 도로 뺏는다.
  //   red 는 사용자가 한 줄 고치면 즉시 풀린다(정책 드리프트처럼 재고정 의식이 필요 없다).
  if (cfg.unknownKeys.length > 0) {
    const bad = cfg.unknownKeys.map((k) => `"${k}"`).join(', ');
    const known = [...KNOWN_CONFIG_KEYS].sort().join(', ');
    issues.push(t({
      en: `${cfg.path} has ${cfg.unknownKeys.length} key(s) this build does not read: ${bad} — they are `
        + 'ignored, so the default is in effect and whatever you meant to enforce with them is not '
        + 'enforced. Fix the spelling or delete the key(s); the keys this build reads are: '
        + `${known}. (doctor cannot repair this — the config file is yours to edit.)`,
      ko: `${cfg.path} 에 이 빌드가 읽지 않는 키가 ${cfg.unknownKeys.length}개 있다: ${bad} — `
        + '무시되므로 기본값이 돌고 있고, 그 키로 걸려던 강제는 걸려 있지 않다. '
        + `철자를 고치거나 그 키를 지워라. 이 빌드가 읽는 키는: ${known}. `
        + '(doctor 는 이것을 복구하지 않는다 — config 파일은 사람이 고치는 것이다.)',
    }));
  }

  // 7. 훅 에러 로그 — 침묵한 판정 실패는 여기서만 드러난다
  const hookErrors = countHookErrors(root);
  if (hookErrors > 0) {
    // [UX-163] 「원인을 확인하라」면서 **어디를 볼지** 안 알려 줬다. 경로는 README 지원 표에만
    // 있었고, doctor 를 돌린 사람은 그 표를 안 보고 있다. 처방은 손이 닿는 곳에 있어야 한다.
    const log = path.join(runtimeDir(root), 'hook-errors.log');
    warnings.push(t({
      en: `${hookErrors} hook decision failure(s) recorded — read ${log} to find out why`,
      ko: `훅 판정 실패 ${hookErrors}건 기록됨 — 원인은 ${log} 에서 확인하라`,
    }));
  }

  // 7b. 정책 무결(OPS-76) — 게이트 산출물 해시와 같은 패턴으로 정책 변경을 관측 가능하게 한다.
  //
  //   **왜 issue 가 아니라 warning 인가.** issues 는 이 파일의 정의상 「state 가 이벤트 재생과
  //   발산한 것 = repair 대상」이다. 정책 드리프트는 재생으로 고칠 수 없고, 고쳐서도 안 된다 —
  //   `doctor --repair` 가 사용자의 config.yaml 을 되돌리면 SEC-69 가 남긴 «사람의 탈출구»를
  //   하네스가 도로 빼앗는 셈이다. issue 로 올리면 사용자가 파일을 되돌릴 때까지 ok=false 가
  //   영구히 박히는데, 이 파일 머리말이 적은 그대로 **영구 red 는 경보를 죽인다.**
  //   그리고 정책 변경은 정당할 수 있다. 목표는 「금지」가 아니라 「보이게」다.
  //
  //   비간섭: `.harness/` 가 없으면 손대지 않는다(하네스 미사용 프로젝트에 파일을 만들지 않는다).
  //   [USE-01] 이 절 전체를 감싸는 이유: `pinnedPolicy` 는 베이스라인을 **저널에서** 읽는다
  //   (`policy.ts` → `readEvents`). 그래서 events.jsonl 을 못 읽으면 위 1단계를 가드해 놓아도
  //   진단이 여기서 다시 죽었다 — 같은 사고에 가드가 두 곳 필요했던 것이다. 정책 절 하나가
  //   진단 전체를 못 내리게 만들 이유는 없다: 못 봤다는 사실만 남기고 나머지 보고는 낸다.
  if (fs.existsSync(harnessDir(root))) try {
    if (opts.acceptPolicy) {
      const pin = pinPolicy(root, 'accept');
      notes.push(
        pin.changed
          ? t({
            en: `policy baseline re-pinned: ${(pin.prevHash ?? 'none').slice(0, 12)} → ${pin.hash.slice(0, 12)} `
              + `(${pin.files.join(', ') || 'no policy files'})`,
            ko: `정책 베이스라인 재고정: ${(pin.prevHash ?? '없음').slice(0, 12)} → ${pin.hash.slice(0, 12)} `
              + `(${pin.files.join(', ') || '정책 파일 없음'})`,
          })
          : t({
            en: 'the policy baseline already matches the files — nothing to accept',
            ko: '정책 베이스라인이 이미 현재 파일과 같다 — 수용할 변경이 없다',
          }),
      );
    }
    const pinned = pinnedPolicy(root);
    const current = computePolicyHash(root);
    if (!pinned) {
      // 베이스라인이 없는 것은 «고장»이 아니라 «장치가 아직 꺼져 있음»이다 — 이 하나로
      // 구 프로젝트 전부가 상시 경고를 달면 진짜 드리프트 경고가 묻힌다. note 로 안내만 한다.
      notes.push(t({
        en: 'the policy baseline is not pinned yet — pin it with `HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy` so that '
          + 'later changes to the policy files become visible',
        ko: '정책 베이스라인이 아직 고정되지 않았다 — `HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy` 로 고정해야 '
          + '이후의 정책 파일 변경이 보인다',
      }));
    } else if (pinned.hash !== current.hash) {
      const added = current.files.filter(f => !pinned.files.includes(f));
      const removed = pinned.files.filter(f => !current.files.includes(f));
      const delta = [
        added.length ? t({ en: `added: ${added.join(', ')}`, ko: `추가: ${added.join(', ')}` }) : '',
        removed.length ? t({ en: `removed: ${removed.join(', ')}`, ko: `삭제: ${removed.join(', ')}` }) : '',
      ].filter(Boolean).join('; ');
      warnings.push(t({
        en: `the policy files differ from the pinned baseline — pinned ${pinned.hash.slice(0, 12)} `
          + `(${pinned.ts}) ≠ current ${current.hash.slice(0, 12)}`
          + (delta ? ` [${delta}]` : '') + `. Files: ${current.files.join(', ') || 'none'}. `
          + 'These files decide what the hook blocks, so a change to them changes the enforcement itself. '
          + 'The change may well be legitimate — review it, then re-pin with `HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy` (the env prefix is the user\'s own hands — an agent cannot run it)',
        ko: `정책 파일이 고정된 베이스라인과 다르다 — 고정 ${pinned.hash.slice(0, 12)} `
          + `(${pinned.ts}) ≠ 현재 ${current.hash.slice(0, 12)}`
          + (delta ? ` [${delta}]` : '') + `. 대상: ${current.files.join(', ') || '없음'}. `
          + '이 파일들이 훅이 무엇을 막을지 정하므로, 여기가 바뀌면 강제 자체가 바뀐 것이다. '
          + '정당한 변경일 수 있다 — 내용을 확인한 뒤 `HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy` 로 재고정하라(env 접두는 사람의 손이다 — 에이전트는 실행할 수 없다)',
      }));
    }
  } catch (e) {
    warnings.push(t({
      en: `the policy baseline could not be checked (${(e as Error).message}) — a change to the files `
        + 'that decide what the hook blocks would not be visible right now. Fix the problem above first.',
      ko: `정책 베이스라인을 확인할 수 없었다 (${(e as Error).message}) — 훅이 무엇을 막을지 정하는 `
        + '파일이 바뀌어도 지금은 보이지 않는다. 위의 문제를 먼저 해결하라.',
    }));
  }

  /**
   * [LOGIC-04] **참조 대상이 사라진 웨이브가 어디에서도 보고되지 않았다.**
   *
   * RTM 의 존재 이유가 「추적 누락 포착」인데, 웨이브의 `design_refs` 가 가리키는 노드가
   * 원장에서 사라져도 `doctor` 는 ok 였고 RTM 은 그 웨이브를 언급조차 하지 않았다.
   * 노드 삭제는 CLI 명령이 아니고 원장은 훅 보호라 발생 확률은 낮지만(브랜치 전환·외부
   * 도구·사람), **침묵 자체가 갭**이다 — 무엇을 구현했는지 알 수 없는 웨이브가 남는다.
   *
   * ADR 도 `design_refs` 에 들어갈 수 있으므로 **노드와 ADR 을 함께** 아는 집합으로 본다.
   * 한쪽만 보면 정상 ADR 참조가 전부 고아로 잡혀 경고가 소음이 된다.
   *
   * 경고(warning)로 낸다 — 강제·정합성을 깨지 않고, 사람이 판단할 사실이다.
   */
  try {
    const known = new Set<string>([
      ...loadLedger(root).map((n) => n.id),
      ...listAdrs(root).map((a) => a.id),
    ]);
    const dangling: string[] = [];
    for (const w of listWaves(root)) {
      for (const ref of w.design_refs ?? []) {
        if (!known.has(ref)) dangling.push(`${w.id} → ${ref}`);
      }
    }
    if (dangling.length > 0) {
      warnings.push(t({
        en: `wave design_refs point at ${dangling.length} id(s) that are in neither the design ledger nor the ADR set: `
          + `${dangling.join(', ')} — the wave says what it implements, but that target is gone. `
          + 'Re-register the node (`harness node upsert`) or fix the wave sheet.',
        ko: `웨이브의 design_refs 중 ${dangling.length}건이 설계 원장에도 ADR 에도 없다: `
          + `${dangling.join(', ')} — 웨이브는 무엇을 구현한다고 적었는데 그 대상이 사라졌다. `
          + '노드를 다시 등록하거나(`harness node upsert`) 웨이브 지시서를 고쳐라.',
      }));
    }
  } catch { /* 원장·웨이브를 못 읽는 상황은 위의 검사들이 이미 말한다 */ }

  // 8. repair — 고칠 발산이 있을 때만 움직인다. 저널이 손상이어도 발산이 없으면 할 일이 없다.
  let repaired = false;
  let refused = false;
  if (issues.length > 0 && opts.repair) {
    if (!trustworthy && !opts.force) {
      refused = true;
      warnings.push(
        tr(root, {
        en: 'State has diverged but the journal cannot be trusted, so repair is refused — find out why '
          + 'the journal is damaged first. To repair anyway, use --force',
        ko: 'state 발산이 있으나 저널을 신뢰할 수 없어 복구 거부 — '
          + '저널 손상 원인을 먼저 확인하라. 그래도 복구하려면 --force',
      }),
      );
    } else {
      // 정산 판정은 repair 가 실제로 쓸 상태(replayed) 기준이다 — current 기준으로 정산하면
      // 발산 복구가 되살릴 activeWave 와 어긋나 다음 doctor 가 다시 발산을 본다.
      const replayedWave = replayed.activeWave;
      const settledActiveWave =
        replayedWave !== null && !fs.existsSync(wavePath(root, replayedWave))
          ? replayedWave
          : null;
      let target = replayed;
      if (settledActiveWave) {
        // 순서 계약: 저널이 먼저. writeState 로만 비우면 재생 결과와 발산해 영구 red 가 된다.
        appendEvent(root, 'wave-stale', {
          id: settledActiveWave, reason: 'wave-file-missing', via: 'doctor-repair',
        });
        target = { ...replayed, activeWave: null }; // = wave-stale 을 포함한 재생 결과
      }
      writeState(root, target);
      // 복구는 흔적을 남긴다 — 나중에 "왜 state 가 이렇게 됐나"의 답이 저널 안에 있어야 한다.
      appendEvent(root, 'doctor-repaired', {
        hadCorruptJournal: !trustworthy,
        forced: !!opts.force,
        settledActiveWave,
      });
      repaired = true;
    }
  }

  // 9. 훅 에러 로그 정리 — 비울 수단이 없으면 warning 이 영구히 남아 새 실패를 가린다.
  //    state 복구와 독립한 유지보수 동작이라 발산(issues)이 없어도 --repair 면 수행한다.
  //    단 **비우지 않고 .prev 로 회전한다**: `.runtime/` 은 gitignore 라 이 파일이 유일본이고,
  //    훅 자신이 "doctor --repair 권장"을 뿌리므로 무관한 사고 대응 중에 증거가 지워진다
  //    (최악은 --force 경로 — 저널 손상 조사 중이라 훅 로그가 교차 증거인 순간이다).
  //    `.prev` 도 `*` 규칙에 걸려 여전히 커밋되지 않는다.
  //    복구가 거부된 경우엔 아예 손대지 않고, warning 은 회전 전 건수 그대로 보고한다.
  if (opts.repair && !refused && hookErrors > 0) {
    const log = path.join(runtimeDir(root), 'hook-errors.log');
    try {
      fs.renameSync(log, `${log}.prev`);
      notes.push(t({
        en: `rotated hook-errors.log (${hookErrors} entries) to .prev`,
        ko: `hook-errors.log ${hookErrors}건 → .prev 회전`,
      }));
    } catch {
      // 회전 실패는 진단을 막지 않는다 — 경고가 남아 다음 실행에 다시 보인다
    }
  }

  // issues 는 복구 후에도 남긴다 — 무엇이 어긋나 있었는지가 보고의 본체다.
  // [UX-121] 다만 **판정(ok)은 수리 후 상태로** 낸다. 한 번 더 돌려야 알 수 있는 보고는
  // 사람에게 같은 일을 두 번 시킨다. 재진단은 수리했을 때만, 수리 없이 한 번만 돈다.
  if (repaired) {
    const after = runDoctor(root, {});
    return { ok: after.issues.length === 0, repaired, refused, issues, remaining: after.issues, warnings, notes };
  }
  return { ok: issues.length === 0, repaired, refused, issues, warnings, notes };
}
