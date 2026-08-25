import * as fs from 'node:fs';
import * as path from 'node:path';

export const harnessDir = (root: string) => path.join(root, '.harness');
export const statePath = (root: string) => path.join(harnessDir(root), 'state.json');
export const eventsPath = (root: string) => path.join(harnessDir(root), 'events.jsonl');
export const configPath = (root: string) => path.join(harnessDir(root), 'config.yaml');
export const designDir = (root: string) => path.join(harnessDir(root), 'design');
export const ledgerPath = (root: string) => path.join(designDir(root), 'ledger.yaml');
/** 산출물 레지스트리(DOC-x 노드) — 설계 원장과 나란히 둔다(§3-7). */
export const registryPath = (root: string) => path.join(designDir(root), 'registry.yaml');
/** 게이트 리뷰 패킷 산출 위치(§4-3). */
export const packetsDir = (root: string) => path.join(harnessDir(root), 'packets');
export const wavesDir = (root: string) => path.join(harnessDir(root), 'waves');
export const wavePath = (root: string, id: string) => path.join(wavesDir(root), `${id}.md`);
export const evidenceDir = (root: string, waveId: string) =>
  path.join(harnessDir(root), 'evidence', waveId);
export const runtimeDir = (root: string) => path.join(harnessDir(root), '.runtime');

/**
 * [SEC-295] **「프로젝트 안인가」는 하나의 규칙이다 — 문구는 표면마다 다르더라도.**
 *
 * 게이트 제출은 루트 밖 경로를 거부한다(「심사자가 리포에서 볼 수 없는 파일에 승인 도장을
 * 찍을 수는 없다」). 그런데 **문서 등록(`doc upsert`)은 받고 있었다** — 그리고 등록된 문서는
 * 그 페이즈의 리뷰 패킷에 「심사 대상」으로 실린다. 실측: `../outside.txt`·`/etc/hosts` 가
 * P0 패킷에 그대로 올라갔다. 같은 질문에 두 답이 있으면 느슨한 쪽이 정본이 된다.
 *
 * 심링크로 밖을 가리키는 경우까지 보려면 실경로로 비교해야 한다. 아직 없는 파일은
 * **존재하는 가장 가까운 조상**까지 풀고 나머지를 다시 붙인다([VAL-134]) — 「없다」를
 * 「밖이다」로 말하면 사람이 무엇을 고쳐야 할지 알 수 없다.
 */
export function realOrNearest(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { /* 위로 */ }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p);        // 루트까지 못 풀면 리터럴
    rest.push(path.basename(cur));
    cur = parent;
  }
}

/** 이 경로가 프로젝트 루트 안인가 — 판정만 한다(사유 문구는 호출측이 낸다). */
export function isInsideRoot(root: string, p: string): boolean {
  const rel = path.relative(realOrNearest(root), realOrNearest(path.resolve(root, p)));
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
