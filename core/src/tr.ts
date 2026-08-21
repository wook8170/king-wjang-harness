/**
 * 코어 모듈에서 언어를 해석하는 통로.
 *
 * `i18n.ts` 는 순수(카탈로그·선택 규칙)하고 `config.ts` 가 파일을 읽는다. 코어 함수들은
 * `root` 는 알지만 `lang` 은 인자로 받지 않으므로(전 시그니처를 바꾸면 침습이 크다)
 * 여기서 root → lang 을 해석한다. 두 모듈을 함께 import 하는 자리를 하나로 모아
 * 순환 의존을 막는다.
 *
 * 캐시하는 이유: 메시지 한 줄마다 YAML 을 다시 파싱할 이유가 없다. 프로세스 수명이 짧고
 * (훅·CLI 는 한 번 실행하고 끝난다) 언어가 실행 중 바뀔 일이 없어 안전하다. 테스트는
 * 프로세스를 공유하므로 `resetLangCache()` 를 준다.
 */
import { loadConfig } from './config';
import { pick, DEFAULT_LANG, type Lang, type Msg } from './i18n';

const cache = new Map<string, Lang>();

export function langFor(root: string): Lang {
  const hit = cache.get(root);
  if (hit) return hit;
  let lang: Lang = DEFAULT_LANG;
  try { lang = loadConfig(root).lang; } catch { /* 설정을 못 읽어도 메시지는 나와야 한다 */ }
  cache.set(root, lang);
  return lang;
}

export function resetLangCache(): void { cache.clear(); }

/** 코어 메시지의 표준 호출부. `throw new Error(tr(root, { en, ko }))` */
export function tr(root: string, m: Msg): string {
  return pick(m, langFor(root));
}
