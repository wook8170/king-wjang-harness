#!/usr/bin/env python3
"""대장의 `파일:줄` 인용이 소스 변경으로 밀렸을 때, **내용을 기준으로** 다시 잡는다.

줄 번호를 델타만큼 더하면 안 된다 — 원래 인용이 `}` 나 `try {` 를 가리키고 있던 경우가
많아서, 밀린 만큼 더하면 그 무의미함이 그대로 따라온다. 여기서는 기준 커밋에서 그 줄의
**내용**을 읽고, 현재 파일에서 같은 내용을 찾아 앵커를 옮긴다. 내용이 무의미하면
(식별자 2글자 미만) 사람이 직접 잡으라고 보고만 한다.
"""
import io, re, subprocess, sys

LEDGER = 'docs/release-readiness/2026-08-21/ledger.md'
CITE = re.compile(r'`([\w/.\-]+\.(?:ts|md|js|yaml|json)):(\d+)`')
BASE = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'

def show(path, n):
    try:
        out = subprocess.run(['git', 'show', f'{BASE}:{path}'], capture_output=True, text=True, check=True).stdout
    except subprocess.CalledProcessError:
        return None
    lines = out.split('\n')
    return lines[n - 1] if 0 < n <= len(lines) else None

def meat(s):
    return re.sub(r'[^0-9A-Za-z_가-힣]', '', s or '')

led = io.open(LEDGER, encoding='utf-8').read()
moved, manual = [], []
for m in CITE.finditer(led):
    path, n = m.group(1), int(m.group(2))
    try:
        cur = io.open(path, encoding='utf-8').read().split('\n')
    except OSError:
        continue
    if 0 < n <= len(cur) and len(meat(cur[n - 1])) >= 2:
        continue                                   # 여전히 쓸모 있는 줄을 가리킨다
    old = show(path, n)
    if old is None or len(meat(old)) < 2:
        manual.append(f'{path}:{n} (기준 커밋에서도 무의미 — 직접 잡아라)')
        continue
    hits = [i + 1 for i, l in enumerate(cur) if l == old]
    if len(hits) != 1:
        manual.append(f'{path}:{n} → 후보 {len(hits)}개 — 직접 잡아라: {old.strip()[:60]}')
        continue
    led = led.replace(f'`{path}:{n}`', f'`{path}:{hits[0]}`')
    moved.append(f'{path}:{n} → {hits[0]}')

io.open(LEDGER, 'w', encoding='utf-8').write(led)
print('\n'.join(f'  옮김 {x}' for x in moved) or '  옮긴 것 없음')
if manual:
    print('\n'.join(f'  ※ 수동 {x}' for x in manual))
