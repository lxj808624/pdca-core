// 中国法定节假日 / 调休日历 —— 判断某一天是「工作日」还是「非工作日」
//
// 为什么需要它：时段表按日型分流（工作日与休息日两套网格）。仅按「周六周日」
// 判断会在春节/国庆这类长假以及调休上班日上误判，所以内置官方日历。
//
// 数据来源：
//   2026 —— 国办发明电〔2025〕7 号（2025-04 发布）
//   2027 —— 国办发明电〔2026〕10 号（2026-11-05 发布）
//   元旦   1/1（周五）–1/3（周日），共 3 天
//   春节   2/5（除夕，周五）–2/13（正月初八，周六），共 9 天；1/31（周日）、2/14（周日）上班
//   清明   4/3（周六）–4/5（周一），共 3 天
//   劳动节 5/1（周六）–5/5（周三），共 5 天；5/8（周六）上班
//   端午   6/9（周三），1 天
//   中秋   9/15（周三），1 天
//   国庆   10/1（周五）–10/7（周四），共 7 天；9/26（周日）、10/9（周六）上班
//
// 维护：每年 11 月国务院发布次年安排后，把新年份加进 HOLIDAYS / MAKEUP_WORKDAYS；
// 或者不改代码，写一份外部 JSON 用环境变量 PDCA_CALENDAR 指过去（格式见下方 loadOverride）。
// 未收录的年份自动退化为「周六周日即非工作日」，并报告 coverage=fallback——
// 前端会显示提示条，避免静默走错档。
import fs from 'node:fs';

const pad = (n) => String(n).padStart(2, '0');
export const dateKeyOf = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

// 放假区间：区间内一律非工作日（含落在周末的日子，周末本身就是非工作日，重复无害）
const HOLIDAYS = {
  2026: [
    { name: '元旦', from: '2026-01-01', to: '2026-01-03' },
    { name: '春节', from: '2026-02-15', to: '2026-02-23' },
    { name: '清明节', from: '2026-04-04', to: '2026-04-06' },
    { name: '劳动节', from: '2026-05-01', to: '2026-05-05' },
    { name: '端午节', from: '2026-06-19', to: '2026-06-21' },
    { name: '中秋节', from: '2026-09-25', to: '2026-09-27' },
    { name: '国庆节', from: '2026-10-01', to: '2026-10-07' }
  ],
  2027: [
    { name: '元旦', from: '2027-01-01', to: '2027-01-03' },
    { name: '春节', from: '2027-02-05', to: '2027-02-13' },
    { name: '清明节', from: '2027-04-03', to: '2027-04-05' },
    { name: '劳动节', from: '2027-05-01', to: '2027-05-05' },
    { name: '端午节', from: '2027-06-09', to: '2027-06-09' },
    { name: '中秋节', from: '2027-09-15', to: '2027-09-15' },
    { name: '国庆节', from: '2027-10-01', to: '2027-10-07' }
  ]
};

// 调休上班日：落在周末但按工作日执行
const MAKEUP_WORKDAYS = {
  2026: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
  2027: ['2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09']
};

// 可选外部日历：PDCA_CALENDAR=/abs/path/calendar.json
//   { "2028": { "holidays": [{ "name": "春节", "from": "2028-01-25", "to": "2028-02-01" }],
//               "makeup": ["2028-01-22"] } }
// 文件不存在或格式不对时只 warn，不影响启动。
function loadOverride() {
  const p = process.env.PDCA_CALENDAR;
  if (!p) return;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [year, def] of Object.entries(raw)) {
      const y = Number(year);
      if (!Number.isInteger(y)) continue;
      if (Array.isArray(def?.holidays)) HOLIDAYS[y] = def.holidays;
      if (Array.isArray(def?.makeup)) MAKEUP_WORKDAYS[y] = def.makeup;
    }
  } catch (e) {
    console.warn(`[calendar] 外部日历 ${p} 读取失败，继续用内置数据：${e.message}`);
  }
}
loadOverride();


export const WORKDAY = 'workday';
export const OFFDAY = 'offday';

// 建索引（模块加载时一次），把区间展开成 Set，判定退化为 O(1) 查表
const holidayIndex = new Map();
const makeupIndex = new Map();
for (const [year, list] of Object.entries(HOLIDAYS)) {
  const set = new Map();
  for (const h of list) {
    const [fy, fm, fd] = h.from.split('-').map(Number);
    const [ty, tm, td] = h.to.split('-').map(Number);
    for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86_400_000) {
      const d = new Date(t);
      set.set(dateKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), h.name);
    }
  }
  holidayIndex.set(Number(year), set);
}
for (const [year, list] of Object.entries(MAKEUP_WORKDAYS)) {
  makeupIndex.set(Number(year), new Set(list));
}

// 日期 → 星期（0=周日）。用 UTC 构造避免本机时区把日期带偏。
export function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// 该年份是否已收录官方日历
export function coverageOf(year) {
  if (Number.isInteger(year) && holidayIndex.has(year)) return 'exact';
  return 'fallback';
}

// 落在放假区间内则返回节日名，否则 null
export function holidayOf({ year, month, day }) {
  const set = holidayIndex.get(year);
  return set ? set.get(dateKeyOf(year, month, day)) ?? null : null;
}

// 落在调休上班日则返回 true
export function isMakeupWorkday({ year, month, day }) {
  const set = makeupIndex.get(year);
  return set ? set.has(dateKeyOf(year, month, day)) : false;
}

// 核心判定：工作日 / 非工作日。优先级 调休上班 > 法定放假 > 周末
export function dayTypeOf(p) {
  if (!p || !Number.isInteger(p.year) || !Number.isInteger(p.month) || !Number.isInteger(p.day)) {
    // 缺少完整日期（老调用的部分字段夹具）时退化为纯周末规则
    return p && (p.weekday === 0 || p.weekday === 6) ? OFFDAY : WORKDAY;
  }
  if (isMakeupWorkday(p)) return WORKDAY;
  if (holidayOf(p)) return OFFDAY;
  const wd = Number.isInteger(p.weekday) ? p.weekday : weekdayOf(p.year, p.month, p.day);
  return wd === 0 || wd === 6 ? OFFDAY : WORKDAY;
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

// 给消息 / 前端用的一句话日型描述，例如「非工作日 · 国庆节（周四）」或「工作日 · 调休上班（周六）」
export function dayTypeLabel(p) {
  const type = dayTypeOf(p);
  const base = type === OFFDAY ? '非工作日' : '工作日';
  const wd = Number.isInteger(p?.weekday) ? `（周${WEEKDAY_CN[p.weekday]}）` : '';
  const holiday = p ? holidayOf(p) : null;
  if (holiday) return `${base} · ${holiday}${wd}`;
  if (p && isMakeupWorkday(p)) return `${base} · 调休上班${wd}`;
  return `${base}${wd}`;
}
