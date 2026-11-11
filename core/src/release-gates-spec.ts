/**
 * 출하 관문 목록(`profile.yaml` 의 `release_gates:`)을 읽는다 — 판정과 실행은 `release-gates.ts` 가 한다.
 *
 * ```yaml
 * release_gates:
 *   - name: security
 *     command: pnpm security:release-check
 *     required: true
 *   - name: static-analysis
 *     command: semgrep scan --config p/owasp-top-ten --error --metrics=off
 *     required: false
 * ```
 *
 * 이 파일은 profile.ts 가 import 한다. 그래서 profile.ts 를 다시 import 하지 않는다(순환 방지).
 */
import type { Msg } from './i18n';

/** 출하 관문 1개. `required` 가 없으면 필수로 본다 — 관문은 막으려고 두는 것이다. */
export interface ReleaseGateSpec {
  name: string;
  /** 비면 미설정이다. 필수 관문인데 비어 있으면 막는다. */
  command?: string;
  required: boolean;
}

/** 관문 이름 — 기록 키 · `--name` 인자로 쓰므로 소문자 · 숫자 · 하이픈만 받는다. */
export const isGateName = (n: string): boolean => /^[a-z0-9][a-z0-9-]{0,63}$/.test(n);

/**
 * `release_gates` 값을 읽는다. 키가 없으면 undefined(옛 단일 설정을 볼 수 있게).
 * 잘못된 항목은 버리고 사유를 `problems` 에 남긴다.
 */
export function parseReleaseGates(
  v: unknown, yamlPath: string, problems: string[], t: (m: Msg) => string,
): ReleaseGateSpec[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    problems.push(t({
      en: `${yamlPath}: \`release_gates\` must be a list of { name, command, required } — ignored`,
      ko: `${yamlPath}: \`release_gates\` 는 { name, command, required } 목록이어야 한다 — 무시했다`,
    }));
    return [];
  }
  const out: ReleaseGateSpec[] = [];
  v.forEach((item, i) => {
    const o = (item && typeof item === 'object' && !Array.isArray(item) ? item : {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const bad = (why: string, ko: string) => problems.push(t({
      en: `${yamlPath}: \`release_gates[${i}]\` ${why} — ignored`,
      ko: `${yamlPath}: \`release_gates[${i}]\` ${ko} — 무시했다`,
    }));
    if (!isGateName(name)) { bad('needs a `name` of lowercase letters, digits and hyphens', '의 `name` 은 소문자 · 숫자 · 하이픈이어야 한다'); return; }
    if (out.some(g => g.name === name)) { bad(`repeats the name \`${name}\``, `의 이름 \`${name}\` 이 겹친다`); return; }
    if (o.command !== undefined && o.command !== null && typeof o.command !== 'string') { bad('`command` must be a string', '의 `command` 는 문자열이어야 한다'); return; }
    if (o.required !== undefined && typeof o.required !== 'boolean') { bad('`required` must be true or false', '의 `required` 는 true 또는 false 여야 한다'); return; }
    const command = typeof o.command === 'string' && o.command.trim() ? o.command.trim() : undefined;
    out.push({ name, ...(command ? { command } : {}), required: o.required !== false });
  });
  return out;
}
