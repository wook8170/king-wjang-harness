/**
 * 자작 도구 마이그레이션 감지 — 스펙 §10 ("설치 시 doctor 가 기존 자작 훅 감지 → 중복 등록
 * 해제 안내").
 *
 * **이 모듈은 절대 아무것도 고치지 않는다.** 사용자의 `~/.claude/` 는 하네스 프로젝트 밖이고,
 * 전역 훅 등록은 다른 프로젝트 전체에 영향을 준다 — 자동 해제는 사용자가 모르는 사이 다른
 * 작업의 안전장치를 꺼버리는 짓이다. 그래서 여기서는 **존재 여부만 읽고 보고**하며, 실제
 * 해제(설정 편집)는 사람이 한다. `migrationReport` 의 문구도 "했다"가 아니라 "하라"로만 쓴다.
 *
 * 감지는 **경로 존재만** 본다. 내용을 파싱하지 않는 이유: 자작 도구는 사용자가 손으로 고칠 수
 * 있고, 형식 추정이 빗나가면 "있는데 없다"고 보고해 중복 발화(하네스 + 구 훅이 동시에 Stop 을
 * 막는 상황)를 놓친다. 존재만 보면 오탐(꺼둔 도구도 보고)은 나지만, 오탐은 사용자가 한 줄로
 * 무시할 수 있고 미탐은 진단 불가능한 이중 차단으로 돌아온다.
 *
 * `homeDir` 는 항상 인자다 — 이 파일에 `os.homedir()` 는 없다(테스트가 임시 홈을 겨눈다).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtimeDir } from './paths';
import { pick, DEFAULT_LANG, type Lang, type Msg } from './i18n';

export interface LegacyTool {
  name: string;
  kind: 'hook' | 'skill' | 'job';
  /** 감지된 실제 경로(사용자가 바로 열어볼 수 있게 절대경로 그대로 보고한다). */
  path: string;
  /** 사용자가 취해야 할 조치 한 줄(해석된 언어). */
  action: string;
}

/** 감지 대상 표. 스펙 §10 의 흡수 표와 1:1. */
const CANDIDATES: ReadonlyArray<{
  name: string;
  kind: LegacyTool['kind'];
  rel: string;
  type: 'dir' | 'file';
  action: Msg;
}> = [
  {
    name: 'handoff-guard',
    kind: 'hook',
    rel: '.claude/handoff-guard',
    type: 'dir',
    action: {
      en: 'The harness replaces Stop blocking and SessionStart injection (judged from wave state, not mtime). '
        + 'Remove the handoff-guard hook registration from settings.json — two hooks would block the same turn twice.',
      ko: '하네스가 Stop 차단·SessionStart 주입을 대체한다(웨이브 상태 기반 정확 판정). settings.json 의 handoff-guard 훅 등록을 지워라 — 두 훅이 같은 턴을 이중으로 막는다.',
    },
  },
  {
    name: 'token-guard',
    kind: 'hook',
    rel: '.claude/token-guard',
    type: 'dir',
    action: {
      en: 'The harness replaces usage-tier judgement and guidance injection. Remove the PostToolUse and '
        + 'UserPromptSubmit hook registrations from settings.json — the same tier message would be injected twice.',
      ko: '하네스가 사용량 티어 판정·지침 주입을 대체한다. settings.json 의 PostToolUse·UserPromptSubmit 훅 등록을 지워라 — 같은 티어 문구가 두 번 주입된다.',
    },
  },
  {
    name: 'auto-retry',
    kind: 'job',
    rel: '.claude/auto-retry',
    type: 'dir',
    action: {
      en: 'Resuming after a usage limit is not replaced by the harness yet (optional component). Leaving it in '
        + 'place does not conflict — but if you later enable the harness resume component, the launchd jobs '
        + 'would duplicate, so turn one off then.',
      ko: '한도 도달 후 재개는 아직 하네스가 대체하지 않는다(옵션 컴포넌트). 그대로 두어도 충돌하지 않는다 — 다만 하네스가 재개 컴포넌트를 켜면 launchd 잡이 중복되니 그때 한쪽을 꺼라.',
    },
  },
  {
    name: 'terse-mode',
    kind: 'hook',
    rel: '.claude/hooks/terse-mode.sh',
    type: 'file',
    action: {
      en: 'The harness absorbed this as `config.yaml: terse: on` (bundled into the SessionStart injection). '
        + 'Remove the terse-mode.sh registration from settings.json.',
      ko: '하네스가 `config.yaml: terse: on` 으로 흡수했다(SessionStart 주입에 동봉). settings.json 의 terse-mode.sh 등록을 지워라.',
    },
  },
];

/**
 * 기존 자작 도구 감지. 발견 순서는 CANDIDATES 표 순서로 고정한다(보고서가 매번 같아야
 * 사용자가 diff 로 읽는다).
 */
export function detectLegacyTools(homeDir: string, lang: Lang = DEFAULT_LANG): LegacyTool[] {
  const found: LegacyTool[] = [];
  for (const c of CANDIDATES) {
    const p = path.join(homeDir, c.rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      continue; // 없으면 조용히 넘어간다 — 이것이 정상 상태다
    }
    if (c.type === 'dir' ? !st.isDirectory() : !st.isFile()) continue;
    found.push({ name: c.name, kind: c.kind, path: p, action: pick(c.action, lang) });
  }
  return found;
}

/** 사람이 읽는 마이그레이션 안내문. 조치는 사용자가 한다 — 이 함수는 아무것도 바꾸지 않는다. */
export function migrationReport(tools: LegacyTool[], lang: Lang = DEFAULT_LANG): string {
  const t = (m: Msg): string => pick(m, lang);
  if (tools.length === 0) {
    return t({
      en: 'Legacy hooks detected: none. There is nothing to unregister.',
      ko: '기존 자작 훅 감지: 없음. 중복 등록 해제 안내 사항이 없다.',
    });
  }
  const lines = [
    t({
      en: `${tools.length} legacy hook(s) detected — this is advice only; the harness never touches your ~/.claude/.`,
      ko: `기존 자작 훅 ${tools.length}건 감지 — 아래는 안내이며 하네스는 사용자의 ~/.claude/ 를 건드리지 않는다.`,
    }),
    t({
      en: 'Leaving both registered makes two systems fire on the same turn. Take the actions below yourself.',
      ko: '중복 등록을 그대로 두면 같은 턴에 두 시스템이 동시에 발화한다. 아래 조치는 직접 수행하라.',
    }),
    '',
  ];
  const actionLabel = t({ en: 'Action', ko: '조치' });
  for (const tool of tools) {
    lines.push(`- ${tool.name} (${tool.kind}) — ${tool.path}`);
    lines.push(`  ${actionLabel}: ${tool.action}`);
  }
  lines.push('');
  lines.push(t({
    en: 'Hook registrations live in ~/.claude/settings.json. Start a new session after editing it.',
    ko: '훅 등록은 ~/.claude/settings.json 에 있다. 편집 후 세션을 새로 시작해야 반영된다.',
  }));
  return lines.join('\n');
}

/**
 * 구 형식 `.harness/.runtime/.gitignore` 감지(이 저장소의 SHIP-02 백로그).
 * `*` 한 줄만 있으면 .gitignore 자신도 무시되어 디렉토리가 통째로 커밋에서 빠지고, 클론한
 * 쪽에서 `.runtime/` 이 없어 훅의 로그 append 가 조용히 실패한다. 현재 형식은 `*` + `!.gitignore`.
 */
export function legacyHarnessGitignore(root: string): boolean {
  try {
    const body = fs.readFileSync(path.join(runtimeDir(root), '.gitignore'), 'utf8');
    return body.trim() === '*';
  } catch {
    return false; // 파일이 없으면 init 전이다 — 진단할 대상이 아니다
  }
}
