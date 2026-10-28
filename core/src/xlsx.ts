/**
 * 최소 xlsx 작성기 — 보안 점검 결과서 한 종류만을 위해 둔다.
 *
 * **왜 라이브러리를 들이지 않는가.** 이 플러그인의 런타임 의존은 `yaml` 하나이고, 그것도 번들에
 * 인라인해 `core/dist` 가 node_modules 없이 돈다([SHIP-04]·[SHIP-11]). xlsx 라이브러리(exceljs·
 * SheetJS)는 수 MB 의 코드와 고지 의무를 함께 끌고 오고, python openpyxl 은 설치자 머신에 파이썬과
 * 패키지를 요구한다 — 결과서 하나를 위해 설치 조건을 늘리는 셈이다. 필요한 것은 「글자·숫자 칸,
 * 굵은 머리행, 열 너비, 틀 고정, 줄바꿈」뿐이라 OOXML 최소 부분과 zip(deflate)을 Node 내장으로 쓴다.
 *
 * **결정적이다.** zip 항목의 시각을 고정하므로 같은 입력은 같은 바이트를 낸다 — 결과서 해시로
 * 「같은 자료에서 만든 것인가」를 볼 수 있다.
 */
import * as zlib from 'node:zlib';

export type Cell = string | number | null | undefined;

export interface Sheet {
  name: string;
  /** 첫 행은 머리행으로 굵게 칠하고 틀을 고정한다. */
  header: string[];
  rows: Cell[][];
  /** 열 너비(문자 수). 빠진 열은 기본 너비. */
  widths?: number[];
}

// ── zip ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 고정 시각(1980-01-01 00:00) — DOS 날짜 형식의 최솟값. 결정적 출력을 위해서다. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflated = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);          // UTF-8 이름
    local.writeUInt16LE(8, 8);               // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + deflated.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ── OOXML ───────────────────────────────────────────────────────────────────

/** XML 1.0 이 허용하지 않는 제어문자는 지운다 — 남기면 Excel 이 파일을 「손상」으로 연다. */
const xml = (s: string): string => s
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Excel 한 칸의 글자 상한(32,767). 넘기면 파일이 열리지 않는다. */
const CELL_MAX = 32767;

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellXml(ref: string, v: Cell, style: number): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  let s = String(v);
  if (s.length > CELL_MAX) s = `${s.slice(0, CELL_MAX - 1)}…`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`;
}

function sheetXml(sh: Sheet): string {
  const rows = [sh.header as Cell[], ...sh.rows];
  const body = rows.map((r, ri) => {
    const style = ri === 0 ? 1 : 2;
    const cells = r.map((v, ci) => cellXml(`${colName(ci)}${ri + 1}`, v, style)).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const cols = (sh.widths ?? []).length
    ? `<cols>${(sh.widths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** 시트 이름 규칙(31자 · `[]:*?/\` 금지 · 중복 금지)을 지킨다 — 어기면 Excel 이 복구 대화상자를 띄운다. */
function sheetNames(sheets: Sheet[]): string[] {
  const seen = new Set<string>();
  return sheets.map((s) => {
    let n = s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
    for (let i = 2; seen.has(n.toLowerCase()); i++) n = `${n.slice(0, 28)} ${i}`;
    seen.add(n.toLowerCase());
    return n;
  });
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/** 시트 목록을 xlsx 바이트로. */
export function buildXlsx(sheets: Sheet[]): Buffer {
  const names = sheetNames(sheets);
  const files: { name: string; data: Buffer }[] = [];
  const add = (name: string, s: string) => files.push({ name, data: Buffer.from(s, 'utf8') });
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>');
  add('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip(files);
}

/**
 * xlsx 를 다시 읽어 시트별 행을 돌려준다 — 이 모듈이 쓴 형태(inlineStr·숫자)만 안다.
 * 판정(결과서가 실제로 있고 읽히는가)과 시험이 쓴다.
 */
export function readXlsx(buf: Buffer): { name: string; rows: string[][] }[] {
  const entries = new Map<string, Buffer>();
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 18);
    const nlen = buf.readUInt16LE(p + 26);
    const elen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8');
    const data = buf.subarray(p + 30 + nlen + elen, p + 30 + nlen + elen + csize);
    entries.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p += 30 + nlen + elen + csize;
  }
  const wb = entries.get('xl/workbook.xml')?.toString('utf8');
  if (!wb) throw new Error('not an xlsx workbook (xl/workbook.xml missing)');
  const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map(m => unxml(m[1]));
  return names.map((name, i) => {
    const xmlText = entries.get(`xl/worksheets/sheet${i + 1}.xml`)?.toString('utf8') ?? '';
    const rows = [...xmlText.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((rm) => {
      const out: string[] = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
        let col = 0;
        for (const ch of cm[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
        const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[2]) ?? /<v>([\s\S]*?)<\/v>/.exec(cm[2]);
        out[col - 1] = t ? unxml(t[1]) : '';
      }
      return Array.from(out, v => v ?? '');
    });
    return { name, rows };
  });
}
