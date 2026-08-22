import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { wavesDir, wavePath, evidenceDir } from './paths';
import { getNode } from './ledger';
import { tr, langFor } from './tr';
import { pick, DEFAULT_LANG, type Lang, type Msg } from './i18n';
import { readState, writeState } from './state';
import { appendEvent, readEvents } from './events';
import { noteTurnLogged } from './runtime';
import type { WaveMeta } from './types';
import { validateEvidence } from './evidence';

/**
 * frontmatter는 신뢰할 수 없는 입력이다 — 손편집·불완전 파일이 들어올 수 있으므로
 * 캐스트 대신 필드별로 정규화한다. id 필드는 참고용일 뿐, 실제 파일 식별은 항상
 * 호출측이 쥔 파일명(id 파라미터) 기준이다 (writeWave 참조).
 */
/** lang 은 호출측(readWave)이 root 에서 해석해 넘긴다 — 순수 파서가 파일을 읽지 않게. */
export function parseWave(txt: string, lang: Lang = DEFAULT_LANG): { meta: WaveMeta; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(txt);
  if (!m) throw new Error(pick({ en: 'Malformed wave file: no frontmatter', ko: '웨이브 파일 형식 오류: frontmatter가 없다' }, lang));
  let raw: unknown;
  try { raw = YAML.parse(m[1]); } catch { raw = null; }
  if (typeof raw !== 'object' || raw === null) throw new Error(pick({ en: 'Malformed wave file: frontmatter could not be parsed', ko: '웨이브 파일 형식 오류: frontmatter를 해석할 수 없다' }, lang));
  const r = raw as Record<string, unknown>;
  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
  const statuses = ['pending', 'active', 'done', 'stale'] as const;
  const meta: WaveMeta = {
    id: typeof r.id === 'string' ? r.id : '',
    milestone: typeof r.milestone === 'string' ? r.milestone : pick(UNSPECIFIED, lang),
    design_refs: asArr(r.design_refs),
    status: statuses.includes(r.status as any) ? r.status as WaveMeta['status'] : 'pending',
    acceptance: asArr(r.acceptance),
  };
  return { meta, body: m[2] };
}

/** 미지정 마일스톤 자리표시자. 저장 시점(cli·mcp)과 해석 시점(여기)이 같은 문장을 쓴다. */
export const UNSPECIFIED: Msg = { en: '(unspecified)', ko: '(미지정)' };

export function serializeWave(meta: WaveMeta, body: string): string {
  return `---\n${YAML.stringify(meta).trimEnd()}\n---\n${body}`;
}

export function readWave(root: string, id: string): { meta: WaveMeta; body: string } {
  return parseWave(fs.readFileSync(wavePath(root, id), 'utf8'), langFor(root));
}

/** 깨진 웨이브 파일은 스킵한다 (bumpNode의 손상 방어와 동일 관용) — 목록 조회가 죽으면 안 된다. */
export function listWaves(root: string): WaveMeta[] {
  if (!fs.existsSync(wavesDir(root))) return [];
  const out: WaveMeta[] = [];
  for (const f of fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()) {
    try {
      out.push(parseWave(fs.readFileSync(path.join(wavesDir(root), f), 'utf8'), langFor(root)).meta);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * 항상 `id`(호출측이 읽거나 지정한 파일명)로 쓴다 — meta.id를 신뢰하지 않는다.
 * frontmatter의 id가 실제 파일명과 어긋나 있어도 엉뚱한 다른 웨이브 파일을 덮지 않기 위함.
 * 웨이브 본문은 저널에도 git에도 백업이 없는 유일한 파일이라 tmp+rename 원자적 쓰기로 보호한다.
 */
function writeWave(root: string, id: string, meta: WaveMeta, body: string): void {
  const target = wavePath(root, id);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, serializeWave(meta, body));
  fs.renameSync(tmp, target);
}

/**
 * 증적으로 인정되는 파일 목록 — dot 파일·빈 파일·디렉토리는 제외한다.
 * 디렉토리 제외가 핵심이다: stat.size 는 디렉토리에서도 0 이 아니라(macOS 64) size 만
 * 보면 **빈 서브디렉토리 하나로 UX 게이트가 통과된다**. 실제 파일만 증적으로 센다.
 *
 * completeWave 의 UX 게이트와 createWave 의 잔존 증적 가드가 반드시 같은 기준을 써야
 * "생성은 통과했는데 완료가 거부"되거나 그 반대인 어긋남이 생기지 않는다.
 */
function evidenceFiles(root: string, id: string): string[] {
  const dir = evidenceDir(root, id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => {
    if (f.startsWith('.')) return false;
    const st = fs.statSync(path.join(dir, f));
    return st.isFile() && st.size > 0;
  });
}

/**
 * 다음 웨이브 번호 = max(디스크 파일명, 저널 wave-created) + 1.
 * 디스크만 보면 웨이브 파일이 사라졌을 때(수동 삭제) 같은 id 가 재발급되어 새 웨이브가
 * 이전 웨이브의 evidence/wave-NNN/ 을 자기 증적으로 물려받는다 — 스크린샷 0장으로 UX
 * 게이트를 통과하는 익스플로잇이 된다.
 *
 * 단, 이 이중 최댓값이 보장하는 단조 증가는 **한 브랜치 안에서만** 성립한다.
 * `.harness/` 는 git 커밋 대상이라 브랜치를 전환하면 events.jsonl 이 waves/ 와 **함께**
 * 되감기고, 그때 미커밋 evidence/ 만 untracked 로 살아남아 번호가 되돌아간다.
 * 그 경로는 createWave 의 잔존 증적 가드가 막는다 — 번호가 아니라 증적을 직접 지킨다.
 */
function nextWaveId(root: string): string {
  const nums: number[] = [];
  if (fs.existsSync(wavesDir(root))) {
    for (const f of fs.readdirSync(wavesDir(root))) {
      const m = /^wave-(\d+)\.md$/.exec(f);
      if (m) nums.push(parseInt(m[1], 10));
    }
  }
  for (const ev of readEvents(root)) {
    if (ev.type !== 'wave-created') continue;
    const id = (ev.data as Record<string, unknown>).id;
    if (typeof id !== 'string') continue; // 손상·비문자열은 무시 (목록 조회의 손상 관용과 동일)
    const m = /^wave-(\d+)$/.exec(id);
    if (m) nums.push(parseInt(m[1], 10));
  }
  return `wave-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

export function createWave(
  root: string,
  opts: { milestone: string; design_refs: string[]; acceptance: string[]; goal: string },
): WaveMeta {
  const lang = langFor(root);
  // [API-92] 목표 필수도 **여기**에 산다 — CLI 만 막고 MCP 는 `goal ?? UNSPECIFIED` 로
  // 빈 껍데기 웨이브를 만들었다(독립 감정이 실측). 목표 없는 지시서는 다음 세션이
  // 이어받을 수 없으므로 [API-29] 가 CLI 에서 막은 것인데, 표면 하나가 그대로 열려 있었다.
  /**
   * [ENG-D] **유령 참조 검증도 여기 산다.** 예전에는 `cli.ts` 와 `mcp.ts` 가 각자 같은 검사를
   * 들고 있었다 — 이 리포가 [LOGIC-93]·[API-92] 로 두 번 고친 바로 그 형태다(어댑터마다
   * 복제하면 세 번째 호출면이 생기는 순간 빠진다). 원장에 없는 id 를 조용히 받으면 STALE
   * 전파도 UX 증적 게이트도 걸리지 않는 참조가 된다(게이트는 `UX-` 접두만 본다).
   */
  const missing = opts.design_refs.filter(id => !getNode(root, id));
  if (missing.length > 0) {
    // [UX-123] 처방은 **부른 표면의 이름**으로 해야 한다. 도메인은 CLI·MCP 양쪽에서 불리는데
    // 문구가 CLI 명령으로 고정돼 있어서, MCP 로 온 에이전트는 존재하지 않는 도구를 찾았다.
    // 어느 쪽에서 왔는지는 호출측만 아니까 **두 이름을 함께** 말한다 — 짧게.
    throw new Error(tr(root, {
      en: `Design refs not in the ledger: ${missing.join(', ')} — register them first: `
        + 'CLI `harness node upsert --id <id> --title <title>`, MCP `harness_node_upsert`',
      ko: `원장에 없는 설계 참조: ${missing.join(', ')} — 먼저 등록하라: `
        + 'CLI `harness node upsert --id <id> --title <제목>` · MCP `harness_node_upsert`',
    }));
  }
  if (!opts.goal.trim() || opts.goal.trim() === pick(UNSPECIFIED, lang)) {
    throw new Error(tr(root, {
      en: 'A wave needs a goal — an instruction sheet without one cannot be picked up by the next session',
      ko: '웨이브 목표가 필요하다 — 목표 없는 지시서는 다음 세션이 이어받을 수 없다',
    }));
  }
  const id = nextWaveId(root);
  // 디스크·저널 최댓값을 모두 반영하므로 정상 경로에서는 도달 불가능한 분기다.
  // 두 프로세스가 같은 순간에 같은 번호를 발급받은 TOCTOU 상황의 안전망 —
  // 남의 웨이브 지시서를 조용히 덮는 것보다 생성을 거부하는 쪽이 안전하다.
  if (fs.existsSync(wavePath(root, id))) {
    throw new Error(tr(root, { en: `${id} already exists — aborting wave creation (concurrent creation suspected)`, ko: `${id} 파일이 이미 존재한다 — 동시 생성 의심으로 웨이브 생성을 중단한다` }));
  }
  // 잔존 증적 가드: 새 웨이브가 남의 스크린샷을 물려받은 채 시작하면 UX 게이트가 무의미해진다.
  // 브랜치 전환으로 저널이 되감겨 번호가 재발급된 경우가 실제 경로다(nextWaveId 주석 참조).
  const inherited = evidenceFiles(root, id);
  if (inherited.length > 0) {
    const sample = `${inherited.slice(0, 3).join(', ')}${inherited.length > 3 ? ', …' : ''}`;
    throw new Error(pick({
      en: `${evidenceDir(root, id)} still holds ${inherited.length} piece(s) of earlier evidence (${sample}) — `
        + 'a new wave inheriting someone else\'s visual evidence disables the UX gate. Check that directory, '
        + 'archive or delete it, then create the wave again.',
      ko: `${evidenceDir(root, id)} 에 이전 증적 ${inherited.length}건(${sample})이 남아 있다 — `
        + '새 웨이브가 남의 시각 증적을 물려받으면 UX 게이트가 무력화된다. '
        + '해당 디렉토리를 확인해 보관하거나 삭제한 뒤 다시 생성하라.',
    }, lang));
  }
  const meta: WaveMeta = { id, milestone: opts.milestone, design_refs: opts.design_refs, status: 'pending', acceptance: opts.acceptance };
  const body = [
    `## ${pick({ en: 'Goal', ko: '목표' }, lang)}`, opts.goal, '',
    `## ${pick({ en: 'Done when', ko: '완료 기준' }, lang)}`, ...opts.acceptance.map(a => `- ${a}`), '',
    `## ${pick({ en: 'Turn log', ko: '턴 로그' }, lang)}`, '',
  ].join('\n');
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-created', { id, milestone: opts.milestone, design_refs: opts.design_refs });
  return meta;
}

export function activateWave(root: string, id: string): void {
  const state = readState(root);
  if (state.activeWave && state.activeWave !== id) {
    throw new Error(tr(root, { en: `A wave is already active: ${state.activeWave}. Complete it first (\`harness wave complete\`).`, ko: `이미 활성 웨이브가 있다: ${state.activeWave}. 먼저 complete 하라.` }));
  }
  let meta: WaveMeta, body: string;
  try {
    ({ meta, body } = readWave(root, id));
  } catch (e) {
    // 파일 부재(ENOENT)만 안내로 바꾼다 — 오타난 id 로 activate 하면 raw ENOENT 대신
    // 목록 확인 경로를 알려준다. 파싱 오류 등 다른 실패는 원인을 감추지 않도록 그대로 던진다.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    throw new Error(
      tr(root, {
        en: `No instruction sheet for wave ${id} (${wavePath(root, id)}) — check the id, or list them `
          + 'with `harness wave list`',
        ko: `웨이브 ${id} 지시서가 없다 (${wavePath(root, id)}) — `
          + 'id 를 확인하거나 `harness wave list` 로 목록을 보라',
      }),
    );
  }
  if (meta.status === 'done') throw new Error(tr(root, { en: `${id} is already done`, ko: `${id} 는 이미 done 이다` }));
  /**
   * [UTIL-105] **STALE 웨이브를 되살려 완료하는 길을 닫는다.**
   *
   * `node bump` 은 활성 웨이브를 STALE 로 정산하고 비활성화한다 — 거기까지는 가드가 있었다.
   * 그런데 그 웨이브를 다시 `activate` 하면 **무경고로** 활성화되고 `complete` 가 `status: done`
   * 을 찍었다. 결과 지시서에는 「구버전 결정 위에 지었다」는 흔적이 남지 않는다.
   * README 의 "nothing silently builds on an outdated decision" 이 advisory 로만 성립했다.
   *
   * 처방은 제품이 이미 말하던 것 그대로다 — `node bump` 의 안내가 「새 웨이브를 만들어라」다.
   * 되살리기를 막고 그 안내로 보낸다(끝단에서 막지 않고 **되살리는 순간** 막는다).
   */
  if (meta.status === 'stale') {
    throw new Error(tr(root, {
      en: `${id} is STALE — the design it referenced (${meta.design_refs.join(', ')}) has moved on since. `
        + 'Re-activating it would silently build on an outdated decision. Open a new wave against the '
        + 'current design instead: `harness wave create --goal "<goal>" --refs '
        + `${meta.design_refs.join(',') || '<ids>'}\`.`,
      ko: `${id} 는 STALE 이다 — 참조한 설계(${meta.design_refs.join(', ')})가 그 뒤로 바뀌었다. `
        + '되살리면 낡은 결정 위에 조용히 짓게 된다. 현재 설계로 새 웨이브를 열어라: '
        + `\`harness wave create --goal "<목표>" --refs ${meta.design_refs.join(',') || '<ids>'}\`.`,
    }));
  }
  meta.status = 'active';
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-activated', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  writeState(root, { ...state, activeWave: id });
}

/**
 * 활성 웨이브 지시서 읽기. **파일 부재(ENOENT)만** 안내 에러로 바꾼다.
 * 지시서가 유실되면 update·complete 가 모두 막히는데(잠금 상태), Node 원문
 * "ENOENT: no such file or directory" 만 보여서는 탈출 경로를 알 수 없다.
 * 문구는 doctor 의 C1 issue 와 톤을 맞춘다 — 복원이 먼저, 정말 유실이면 정산.
 * 파싱 오류 등 다른 실패는 원인을 감추지 않도록 그대로 던진다.
 */
function readActiveWave(root: string, id: string): { meta: WaveMeta; body: string } {
  try {
    return readWave(root, id);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    throw new Error(
      tr(root, {
        en: `The instruction sheet for the active wave ${id} is missing (${wavePath(root, id)}) — it may be `
          + 'temporarily absent (a git branch switch, say), so restoring the file comes first. If it really '
          + 'is lost, settle activeWave to null with `harness doctor --repair`.',
        ko: `활성 웨이브 ${id} 의 지시서가 없다 (${wavePath(root, id)}) — `
          + 'git 브랜치 전환 등으로 일시 부재일 수 있으니 파일 복원이 우선이다. '
          + '정말 유실이면 `harness doctor --repair` 로 activeWave 를 정산(null)하라.',
      }),
    );
  }
}

export function logTurn(root: string, text: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error(tr(root, { en: 'No active wave — activate one with `harness wave activate <wave-id>`', ko: '활성 웨이브가 없다 — `harness wave activate <wave-id>` 로 활성화하라' }));
  const id = state.activeWave;
  const { meta, body } = readActiveWave(root, id);
  const entry = `- [${new Date().toISOString()}] ${text}`;
  writeWave(root, id, meta, body.trimEnd() + '\n' + entry + '\n');
  appendEvent(root, 'wave-turn-logged', { id }); // 순서 계약: 저널이 먼저
  noteTurnLogged(root);
}

export function completeWave(root: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error(tr(root, { en: 'No active wave — activate one with `harness wave activate <wave-id>`', ko: '활성 웨이브가 없다 — `harness wave activate <wave-id>` 로 활성화하라' }));
  const id = state.activeWave;
  const { meta, body } = readActiveWave(root, id);
  if (meta.design_refs.some(r => r.startsWith('UX-'))) {
    const dir = evidenceDir(root, id);
    // [QUAL-104] **제품이 이미 가진 검사를 게이트가 부른다.** 예전에는 「파일이 있는가」만 봐서
    // 9바이트 텍스트를 `mock.png` 로 두면 통과했다 — `evidence check` 는 같은 파일에
    // "cannot read the PNG header" 를 내고 있었는데도. 기준은 `validateEvidence` 한 벌이다.
    const report = validateEvidence(root, id);
    if (report.usable.length === 0) {
      const uxRefs = meta.design_refs.filter(r => r.startsWith('UX-')).join(', ');
      // **파일이 있는데 못 쓰는 경우와 아예 없는 경우는 다른 문제다.** 「증적이 없다」로 뭉치면
      // 이미 파일을 넣은 사람이 같은 파일을 또 넣는다 — 틀린 곳을 가리키는 오류문은 없느니만 못하다.
      // [UX-160] 판별을 `files` 가 아니라 `entries` 로 한다. `files` 는 0바이트·끊긴 심링크·
      // 서브디렉토리를 **담기 전에 continue** 하므로, 0바이트 캡처를 넣은 사람에게도
      // "증적이 없다" 가 나갔다 — 방금 파일을 넣은 사람에게 파일을 넣으라는 문구다.
      // 항목을 하나라도 봤다면 「거기 뭔가 있는데 세지 않는다」이고, 그 사유를 그대로 보여 준다.
      const why = report.entries > 0
        ? tr(root, {
            en: `the files there do not count as evidence:\n  - ${report.problems.join('\n  - ')}`,
            ko: `거기 있는 파일은 증적으로 세지 않는다:\n  - ${report.problems.join('\n  - ')}`,
          })
        : tr(root, {
            en: `there is no visual evidence. Put a screenshot in ${dir}.`,
            ko: `시각 증적이 없다. ${dir} 에 스크린샷을 넣어라.`,
          });
      throw new Error(
        tr(root, {
          en: `A wave referencing UX nodes (${uxRefs}) cannot be completed — ${why}`,
          ko: `UX 노드(${uxRefs})를 참조하는 웨이브는 완료할 수 없다 — ${why}`,
        }),
      );
    }
  }
  meta.status = 'done';
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-completed', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  writeState(root, { ...state, activeWave: null });
}

/**
 * STALE 마킹. 대상이 활성 웨이브면 activeWave 를 정산(null)한다 —
 * **그 순간 stop 가드(활성 웨이브가 있어야 턴 로그를 강제)도 함께 풀린다.**
 * 즉 마킹 이전의 미정산 작업이 로그 없이 세션을 끝낼 수 있으므로, 호출측은 활성 웨이브가
 * 정산됐다는 사실을 사용자에게 고지해야 한다(cli.ts 의 `node bump` 분기 참조).
 */
export function markStale(root: string, id: string): void {
  const { meta, body } = readWave(root, id);
  meta.status = 'stale';
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-stale', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  const state = readState(root);
  if (state.activeWave === id) writeState(root, { ...state, activeWave: null });
}
