// 欄位值格式化的前端鏡像（權威實作在 Go 後端 internal/engine/format.go，兩邊需同步）。
// 僅用於「畫布即時預覽」——渲染輸出一律以後端為準。

import { ValueFormat } from '../models/template.model';

export function formatValue(s: string, format: ValueFormat | undefined): string {
  switch (format) {
    case 'comma': return commaFormat(s);
    case 'twUpper': return twUpperAmount(s);
    case 'rocDate': return rocDate(s, false);
    case 'rocDateLong': return rocDate(s, true);
    default: return s;
  }
}

function splitNumber(s: string): { neg: boolean; intPart: string; decPart: string } | null {
  s = s.trim().replace(/,/g, '');
  if (!s) return null;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  else if (s[0] === '+') s = s.slice(1);
  const [intRaw, decPart = ''] = s.split('.');
  const intPart = intRaw === '' ? '0' : intRaw;
  if (!/^\d+$/.test(intPart + decPart)) return null;
  return { neg, intPart, decPart };
}

function commaFormat(s: string): string {
  const n = splitNumber(s);
  if (!n) return s;
  const grouped = n.intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n.neg ? '-' : '') + grouped + (n.decPart ? '.' + n.decPart : '');
}

const TW_DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const TW_SMALL = ['', '拾', '佰', '仟'];
const TW_BIG = ['', '萬', '億', '兆'];

function twConvert4(g: string): string {
  let out = '';
  let zeroPending = false;
  for (let i = 0; i < g.length; i++) {
    const d = g.charCodeAt(i) - 48;
    if (d === 0) {
      if (out) zeroPending = true;
      continue;
    }
    if (zeroPending) { out += '零'; zeroPending = false; }
    out += TW_DIGITS[d] + TW_SMALL[g.length - i - 1];
  }
  return out;
}

function twUpperAmount(s: string): string {
  const n = splitNumber(s);
  if (!n) return s;
  let intPart = n.intPart.replace(/^0+/, '');
  const sections: string[] = [];
  while (intPart.length > 4) {
    sections.unshift(intPart.slice(-4));
    intPart = intPart.slice(0, -4);
  }
  if (intPart) sections.unshift(intPart);

  let out = '';
  sections.forEach((sec, i) => {
    const secStr = twConvert4(sec);
    if (!secStr) return;
    if (out && sec[0] === '0') out += '零';
    out += secStr + TW_BIG[sections.length - 1 - i];
  });
  if (!out) out = '零';
  out += '元';

  const jiao = n.decPart[0] ?? '0';
  const fen = n.decPart[1] ?? '0';
  if (jiao === '0' && fen === '0') {
    out += '整';
  } else {
    if (jiao !== '0') out += TW_DIGITS[+jiao] + '角';
    if (fen !== '0') out += TW_DIGITS[+fen] + '分';
  }
  return (n.neg ? '負' : '') + out;
}

function rocDate(s: string, long: boolean): string {
  let d = s.trim();
  const cut = d.search(/[ T]/);
  if (cut > 0) d = d.slice(0, cut);
  const sep = d.includes('/') ? '/' : '-';
  const parts = d.split(sep);
  if (parts.length !== 3 || parts.some(p => !/^\d+$/.test(p))) return s;
  const [y, m, day] = parts.map(Number);
  if (y < 1912 || m < 1 || m > 12 || day < 1 || day > 31) return s;
  const roc = y - 1911;
  return long
    ? `民國${roc}年${m}月${day}日`
    : `${roc}/${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}
