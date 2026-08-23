#!/usr/bin/env python3
"""대장 헤더 집계와 00-summary 판정 블록의 open 목록을 대장에서 다시 센다.

손으로 세는 구조가 세 번 사고를 냈다(VAL-B). 리포 안 테스트가 그것을 막지만,
막힌 뒤에 손으로 고치는 것도 같은 구조다 — 여기서 한 번에 다시 센다.
"""
import io, re, sys

LEDGER = 'docs/release-readiness/2026-08-21/ledger.md'
SUMMARY = 'docs/release-readiness/2026-08-21/00-summary.md'
ROW = re.compile(r'^\| ([A-Z][A-Z0-9]*-[A-Z0-9]+) \|')

led = io.open(LEDGER, encoding='utf-8').read()
v = d = 0
med, low, other = [], [], []
ob = oh = 0
for line in led.split('\n'):
    if not ROW.match(line):
        continue
    f = [x.strip() for x in line.split('|')]
    sev, st = f[2], f[5]
    if st == 'verified':
        v += 1
    elif st == 'deferred':
        d += 1
    elif st in ('open', 'fixing'):
        (med if sev == 'MED' else low if sev == 'LOW' else other).append(f[1])
        ob += sev == 'BLOCKER'
        oh += sev == 'HIGH'
o = len(med) + len(low) + len(other)

hdr = re.search(r'^\*\*갱신\*\*.*$', led, re.M).group(0)
new_hdr = re.sub(r'\*\*open BLOCKER\*\* \d+', f'**open BLOCKER** {ob}', hdr)
new_hdr = re.sub(r'\*\*open HIGH\*\* \d+', f'**open HIGH** {oh}', new_hdr)
new_hdr = re.sub(r'\*\*open 전체\*\* \d+ \([^)]*\)',
                 f'**open 전체** {o} (MED {len(med)} · LOW {len(low)})', new_hdr)
new_hdr = re.sub(r'\*\*verified\*\* \d+', f'**verified** {v}', new_hdr)
new_hdr = re.sub(r'\*\*deferred\*\* \d+', f'**deferred** {d}', new_hdr)
io.open(LEDGER, 'w', encoding='utf-8').write(led.replace(hdr, new_hdr, 1))

s = io.open(SUMMARY, encoding='utf-8').read()
s = re.sub(r'> ### 남은 open \d+건 — MED \d+ · LOW \d+',
           f'> ### 남은 open {o}건 — MED {len(med)} · LOW {len(low)}', s, count=1)
s = re.sub(r'> \*\*MED \(\d+\)\*\* .*',
           '> **MED (%d)** %s' % (len(med), ' · '.join(f'`{i}`' for i in med)), s, count=1)
s = re.sub(r'> \*\*LOW \(\d+\)\*\* .*',
           '> **LOW (%d)** %s' % (len(low), ' · '.join(f'`{i}`' for i in low)), s, count=1)
s = re.sub(r'> 대장 집계: \*\*verified\*\* \d+ · \*\*open\*\* \d+ \([^)]*\) · deferred \d+ ·',
           f'> 대장 집계: **verified** {v} · **open** {o} (MED {len(med)} · LOW {len(low)}) · deferred {d} ·',
           s, count=1)
io.open(SUMMARY, 'w', encoding='utf-8').write(s)
print(f'verified {v} · open {o} (MED {len(med)} · LOW {len(low)}) · deferred {d} · openBLOCKER {ob} · openHIGH {oh}')
if other:
    print('※ MED/LOW 아닌 open:', ', '.join(other), file=sys.stderr)
