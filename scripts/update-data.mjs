// Fetch latest TWSE closes: TAIEX (發行量加權股價指數), 00631L, 00685L → data.json
import { readFile, writeFile } from 'node:fs/promises';

const CODES = ['00631L', '00685L'];
const UA = { 'User-Agent': 'Mozilla/5.0 (l2-breakeven daily updater)', Accept: 'application/json' };
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
// ROC "1141120" or "114/11/20" or "20251120" → "2025-11-20"
const isoDate = v => {
  const s = String(v ?? '').replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  if (s.length === 7) return `${+s.slice(0, 3) + 1911}-${s.slice(3, 5)}-${s.slice(5)}`;
  return null;
};
async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.json();
      console.warn(url, r.status);
    } catch (e) { console.warn(url, e.message); }
    await new Promise(r => setTimeout(r, 3000 * (i + 1)));
  }
  return null;
}

async function fromOpenApi() {
  const [idx, all] = await Promise.all([
    getJSON('https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX'),
    getJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
  ]);
  if (!Array.isArray(idx) || !Array.isArray(all)) return null;
  const row = idx.find(r => (r['指數'] || r.Index || '').includes('發行量加權股價指數'));
  const out = { index: num(row?.['收盤指數'] ?? row?.ClosingIndex), date: isoDate(row?.['日期'] ?? row?.Date), prices: {} };
  for (const c of CODES) {
    const s = all.find(r => (r.Code || r['證券代號']) === c);
    out.prices[c] = num(s?.ClosingPrice ?? s?.['收盤價']);
    out.date ||= isoDate(s?.Date ?? s?.['日期']);
  }
  return out;
}

async function fromRwd() {
  const idx = await getJSON('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&type=IND');
  let index = null, date = isoDate(idx?.date);
  for (const t of idx?.tables || [idx]) for (const r of t?.data || []) if (String(r[0]).includes('發行量加權股價指數')) index = num(r[1]);
  const prices = {};
  for (const c of CODES) {
    const d = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&stockNo=${c}`);
    const last = d?.data?.at(-1);
    prices[c] = num(last?.[6]);
    if (last) date ||= isoDate(last[0]);
  }
  return { index, date, prices };
}

const ok = d => d && d.index && d.date && CODES.every(c => d.prices[c]);
let data = await fromOpenApi();
if (!ok(data)) { console.warn('openapi incomplete:', JSON.stringify(data)); data = await fromRwd(); }
if (!ok(data)) { console.error('Could not get complete data:', JSON.stringify(data)); process.exit(1); }

let prev = null;
try { prev = JSON.parse(await readFile('data.json', 'utf8')); } catch {}
if (prev && prev.date >= data.date && prev.index === data.index) { console.log('No new data', data.date); process.exit(0); }

const out = { date: data.date, index: data.index, prices: data.prices, source: 'TWSE', updatedAt: new Date().toISOString() };
await writeFile('data.json', JSON.stringify(out, null, 2) + '\n');
console.log('Updated', out);
