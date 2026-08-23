/**
 * 출력 언어 선택 (상품성 — 감정서 §05 「한국어 전용」).
 *
 * **기본은 영어다.** 마켓플레이스에 올라가는 플러그인의 첫 화면이 읽을 수 없는 언어면
 * 그 뒤가 아무리 좋아도 도달하지 않는다. 한국어는 옵션으로 남긴다 — 없애는 게 아니라
 * 기본값을 바꾸는 것이다.
 *
 * 해석 순서 (앞이 이긴다):
 *   1. `HARNESS_LANG` 환경변수 — 일회성 전환·CI 에서 유용
 *   2. `.harness/config.yaml` 의 `lang:` — 프로젝트 설정
 *   3. `en`
 *
 * 왜 `LANG`/`LC_ALL` 을 안 보나: 한국어 로케일에서 일하는 사람이 영문 도구를 쓰는 일은
 * 흔하다. OS 로케일로 CLI 언어를 추측하면 원치 않는 전환이 조용히 일어난다 — 언어는
 * **명시적으로만** 바꾼다.
 */
export const LANGS = ['en', 'ko'] as const;
export type Lang = (typeof LANGS)[number];

export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

/** 문자열 한 벌. `en` 은 필수, `ko` 는 있으면 쓴다(없으면 영어로 떨어진다). */
export type Msg = { en: string; ko?: string };

/**
 * 메시지를 고른다. 번역이 빠진 자리는 **영어로 떨어질 뿐 깨지지 않는다** — 번역이 코드보다
 * 늦게 따라오는 것은 정상이고, 그때 빈 문자열이나 키 이름이 노출되는 게 최악이다.
 */
export function pick(m: Msg, lang: Lang): string {
  return lang === 'ko' && m.ko ? m.ko : m.en;
}

/** config 를 읽을 수 없는 자리(미초기화 프로젝트 등)를 위한 env 전용 해석. */
export function langFromEnv(env: NodeJS.ProcessEnv = process.env): Lang | undefined {
  const v = env.HARNESS_LANG;
  return isLang(v) ? v : undefined;
}

export const DEFAULT_LANG: Lang = 'en';
