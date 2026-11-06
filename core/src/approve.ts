/**
 * 게이트 승인의 세 경로 — 터미널 · 확인 창(dialog) · 슬래시 명령(slash).
 *
 * 승인은 사람의 판단이다. 그런데 터미널 경로만 있으면 사용자가 판 번호가 든 캐시 경로를 손으로
 * 쳐야 하고, 원격에서는 칠 곳이 없다. 그래서 두 경로를 더한다. 두 경로 모두 CLI 의 TTY 검사를
 * 대신할 **표(ticket)** 가 필요하다: 에이전트의 Bash 호출에는 TTY 가 없기 때문이다.
 *
 * - **확인 창**: 훅이 `permissionDecision: "ask"` 와 함께 `updatedInput` 으로 명령 끝에
 *   일회용 표를 붙인다. 실측(Claude Code 2.1.319): 모델의 기록에는 원래 명령만 남고, 거절된
 *   호출은 대화 기록에도 표를 남기지 않는다. 저장소에는 해시만 두므로 창이 거절되면 그 표는
 *   아무도 쓸 수 없다.
 * - **슬래시 명령**: `UserPromptExpansion` 훅이 사용자가 친 명령을 보고 표를 낸다. 이 이벤트는
 *   사람이 입력한 명령에서만 발생한다(공식 문서). 본문의 `!` 명령에는 값을 건넬 길이 없어
 *   비밀값 대신 짧은 유효 시간으로 범위를 좁힌다.
 *
 * **한계**: 호출자가 사람임을 코드로 증명하지는 못한다. 창의 응답은 Claude Code 가 받고 훅은
 * 결과를 보지 못한다. 에이전트가 훅이 알아보지 못하는 형태로 표 파일을 쓰고 난독화한 호출을
 * 함께 돌리는 길도 남는다(README 「알려진 한계」).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { harnessCliPath, runtimeDir } from './paths';
import { PHASES, isPhase, type Phase } from './types';

export type ApprovalVia = 'terminal' | 'dialog' | 'slash' | 'no-tty';

/**
 * 창을 띄워도 되는 권한 모드 — **허용 목록**이다.
 *
 * `default`·`acceptEdits`·`auto` 는 실측에서 사람에게 창이 떴다. `auto` 는 공식 문서도 분류기가
 * `ask` 를 대신 판정하지 않는다고 적는다. `dontAsk`·`plan` 은 2.1.319 에서 창이 떴지만 문서의
 * 정의(묻지 않고 거부)나 모드의 취지와 맞지 않아 넣지 않는다. `bypassPermissions` 는 대화형
 * 동작을 재현하지 못했다. 모르는 값은 모두 거부 쪽으로 간다.
 */
const ASK_MODES: readonly string[] = ['default', 'acceptEdits', 'auto'];

/** 표의 유효 시간. 창은 응답할 때까지 열려 있으므로 길게 두고, 슬래시 표는 곧바로 쓰이므로 짧게 둔다. */
const DIALOG_TTL_MS = 30 * 60 * 1000;
const SLASH_TTL_MS = 60 * 1000;

interface Ticket {
  kind: 'dialog' | 'slash';
  phase: Phase;
  artifactHash: string;
  issuedAt: number;
  /** dialog 표에만 있다. 원문은 명령에만 실리고 여기에는 해시만 남는다. */
  nonceHash?: string;
}

const ticketPath = (root: string): string => path.join(runtimeDir(root), 'approve-ticket');
const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

function writeTicket(root: string, t: Ticket): void {
  fs.mkdirSync(runtimeDir(root), { recursive: true });
  const tmp = `${ticketPath(root)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(t), { mode: 0o600 });
  fs.renameSync(tmp, ticketPath(root));
}

/** 창에 실을 표를 낸다. 돌려준 원문은 명령에만 싣는다 — 이전 표는 이 순간 무효가 된다. */
export function issueDialogTicket(root: string, phase: Phase, artifactHash: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  writeTicket(root, { kind: 'dialog', phase, artifactHash, issuedAt: Date.now(), nonceHash: sha256(nonce) });
  return nonce;
}

export function issueSlashTicket(root: string, phase: Phase, artifactHash: string): void {
  writeTicket(root, { kind: 'slash', phase, artifactHash, issuedAt: Date.now() });
}

/**
 * 표를 확인하고 쓴다. 맞으면 지우고 true 를 돌려준다.
 * 틀린 원문으로는 지우지 않는다 — 틀린 호출 한 번으로 사람이 보고 있는 창이 무효가 되면 안 된다.
 */
export function consumeTicket(
  root: string,
  kind: Ticket['kind'],
  phase: Phase,
  artifactHash: string | undefined,
  nonce: string | undefined,
  now: number = Date.now(),
): boolean {
  let t: Ticket;
  try { t = JSON.parse(fs.readFileSync(ticketPath(root), 'utf8')) as Ticket; } catch { return false; }
  if (t.kind !== kind || t.phase !== phase || t.artifactHash !== artifactHash) return false;
  if (kind === 'dialog' && (!nonce || !t.nonceHash || sha256(nonce) !== t.nonceHash)) return false;
  const age = now - t.issuedAt;
  if (!(age >= 0 && age <= (kind === 'dialog' ? DIALOG_TTL_MS : SLASH_TTL_MS))) return false;
  fs.rmSync(ticketPath(root), { force: true });
  return true;
}

/**
 * `harness gate approve <P>` 를 그대로 한 줄만 실행하는 호출인가. 맞으면 페이즈를 돌려준다.
 *
 * `&&`·파이프·치환·리다이렉트·개행·env 접두가 하나라도 붙으면 맞지 않는다. 사람이 승인한 명령과
 * 실제로 도는 명령이 달라지는 일을 막는다. 경로를 적은 호출도 받지 않는다.
 */
export function parseApproveCall(cmd: string): { phase: Phase } | null {
  const m = /^harness[ \t]+gate[ \t]+approve[ \t]+(P\d{1,2})$/u.exec(cmd.trim());
  return m && isPhase(m[1]) ? { phase: m[1] } : null;
}

export function askableMode(mode: string | undefined): boolean {
  return mode !== undefined && ASK_MODES.includes(mode);
}

/**
 * 사람이 앞에 있는 대화형 세션인가. `-p`·SDK 에서는 답할 사람이 없거나 답을 코드가 낸다
 * (실측: `-p` 는 `sdk-cli`, 대화형과 Remote Control 세션은 `cli`). 그 밖의 표면은 확인하지
 * 못했으므로 거부 쪽으로 둔다.
 */
export function interactiveEntrypoint(): boolean {
  return process.env.CLAUDE_CODE_ENTRYPOINT === 'cli';
}

function settingsFiles(root: string): string[] {
  const home = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
  return [
    path.join(home, 'settings.json'),
    path.join(root, '.claude', 'settings.json'),
    path.join(root, '.claude', 'settings.local.json'),
  ];
}

/** `Bash(...)` 규칙의 안쪽 패턴을 정규식으로 옮긴다. `*` 와 옛 표기 `:*` 만 특수 문자다. */
function ruleMatches(rule: string, commands: readonly string[]): boolean {
  if (rule === 'Bash') return true;
  const m = /^Bash\((.*)\)$/su.exec(rule);
  if (!m) return false;
  const body = m[1].replace(/:\*$/u, ' *');
  const re = new RegExp(`^${body.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('.*')}$`, 'su');
  return commands.some(c => re.test(c));
}

/**
 * 사용자 설정의 허용 규칙이 `gate approve` 를 덮는가. 덮으면 그 파일과 규칙을 돌려준다.
 *
 * 2.1.319 실측에서는 허용 규칙이 있어도 훅의 `ask` 창이 떴다. 다만 문서가 이 우선순위를 적지
 * 않아 판이 바뀌면 달라질 수 있으므로 거부 쪽으로 둔다. 조직 관리 설정은 위치가 OS 마다 달라
 * 읽지 않는다.
 */
export function approveAllowRule(root: string): { file: string; rule: string } | null {
  const commands = PHASES.flatMap(p => ['harness', harnessCliPath()].flatMap(h => [
    `${h} gate approve ${p}`,
    `${h} gate approve ${p} --dialog-ticket 0`,
  ]));
  for (const file of settingsFiles(root)) {
    let allow: unknown;
    try { allow = JSON.parse(fs.readFileSync(file, 'utf8'))?.permissions?.allow; } catch { continue; }
    if (!Array.isArray(allow)) continue;
    for (const rule of allow) {
      if (typeof rule === 'string' && ruleMatches(rule.trim(), commands)) return { file, rule };
    }
  }
  return null;
}
