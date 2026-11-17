// 「当下该做什么」引擎：时段表（工作日 / 非工作日分流）+ 今日目标状态 → 任意时刻的建议
import { priorityRank, getMeta } from './db.js';
import { dayTypeOf, dayTypeLabel, holidayOf, coverageOf, WORKDAY, OFFDAY } from './calendar.js';
import { MODULES, SLOT_MODULES, PILLAR_OF, baseModule, subLineOf, isWeeklyCadence, cadenceOf, hasGoalCadence } from './modules.js';
import { PROFILE, TZ } from './profile.js';
import { userModules } from './usermodules.js';

// 时段表来自 profile（世界观配置），不再读独立 schedule.json
const schedule = PROFILE.schedule;
export { TZ };
export { MODULES, SLOT_MODULES, PILLAR_OF, baseModule, isWeeklyCadence, cadenceOf, hasGoalCadence, WORKDAY, OFFDAY };

function hhmmToMin(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function minToHhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// 睡觉时段（配置在 schedule.json 的 sleep）：23:55 起算，跨零点到 08:00
export const SLEEP = {
  start: schedule.sleep?.start ?? '23:55',
  end: schedule.sleep?.end ?? '08:00',
  module: schedule.sleep?.module ?? '睡觉',
  label: schedule.sleep?.label ?? '睡觉时间',
  tip: schedule.sleep?.tip ?? null,
  startMin: hhmmToMin(schedule.sleep?.start ?? '23:55'),
  endMin: hhmmToMin(schedule.sleep?.end ?? '08:00')
};

// 跨零点的睡眠判定：起点 > 终点，故用「或」
export function isSleepingMin(nowMin) {
  return nowMin >= SLEEP.startMin || nowMin < SLEEP.endMin;
}

// ---------- 时区安全的时间工具 ----------

export function zonedParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short'
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = +parts.hour;
  const minute = +parts.minute;
  const base = {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour,
    minute,
    weekday: wd[parts.weekday] ?? 0,
    minutesOfDay: hour * 60 + minute,
    dateLabel: `${+parts.month}/${+parts.day}`
  };
  // 日型（工作日 / 非工作日）随日期一起产出：时段表按日型分流，所有调用方都拿得到同一个判定
  return {
    ...base,
    dayType: dayTypeOf(base),
    dayTypeLabel: dayTypeLabel(base),
    holiday: holidayOf(base),
    calendarCoverage: coverageOf(base.year)
  };
}

// 周一为一周起点，返回 "M/D-M/D" 标签（与目标命名约定一致）
export function weekRange(p) {
  const monIdx = (p.weekday + 6) % 7;
  const mk = (offset) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    return d;
  };
  const s = mk(-monIdx);
  const e = mk(6 - monIdx);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(s)}-${fmt(e)}`;
}

// ---------- 目标命名约定解析 ----------

export function parseDayGoal(name) {
  // 规范写法「今日(11/11)·…」，同时容忍「11月11日·…」
  const m = name.match(/^今日\((\d{1,2})\/(\d{1,2})\)/) || name.match(/^(\d{1,2})月(\d{1,2})日/);
  return m ? { month: +m[1], day: +m[2] } : null;
}

export function parseWeekGoal(name) {
  // 兼容两种格式：本周(7/25-26) 与 本周(7/25-7/26)（跨年周如 12/29-1/4 必须带月末月份）
  const m = name.match(/^本周\((\d{1,2})\/(\d{1,2})-(?:(\d{1,2})\/)?(\d{1,2})\)/);
  if (!m) return null;
  const sm = +m[1], sd = +m[2];
  const em = m[3] ? +m[3] : sm, ed = +m[4];
  const startKey = sm * 100 + sd;
  const endKey = em * 100 + ed;
  return { startKey, endKey };
}

export function parseMonthGoal(name) {
  // 规范写法「11月：…」，同时容忍「11月·…」「11月 …」
  const m = name.match(/^(\d{1,2})月(?:[：:·]|\s|$)/);
  return m ? { month: +m[1] } : null;
}

function mdKey(month, day) {
  return month * 100 + day;
}

export function isToday(dayGoal, p) {
  const d = parseDayGoal(dayGoal.name);
  return !!d && d.month === p.month && d.day === p.day;
}

export function isCurrentWeek(weekGoal, p) {
  const w = parseWeekGoal(weekGoal.name);
  if (!w) return false;
  const key = mdKey(p.month, p.day);
  if (w.startKey <= w.endKey) return key >= w.startKey && key <= w.endKey;
  // 跨年周（如 12/29-1/4）
  return key >= w.startKey || key <= w.endKey;
}

// ---------- 时段表 ----------

// 某条时段在给定日型下是否生效（days 缺省 = all，即每天）
function slotApplies(t, dayType) {
  const want = t.days ?? 'all';
  return want === 'all' || want === dayType;
}

// 当天生效的时段表（按日型分流）。
// inSleep 的条目（07:00 昨日回顾）整段落在睡觉时段内：它只由定时任务推送消息，不占时段条、
// 不参与 activeTask/nextTask —— 否则会与「23:55–08:00 睡觉」重叠，两个时段互相遮蔽。
export function todayTasks(p) {
  const dayType = p.dayType ?? dayTypeOf(p);
  const list = schedule.daily.filter((t) => slotApplies(t, dayType) && !t.inSleep);
  for (const t of schedule.weekly) if (t.dayOfWeek === p.weekday) list.push(t);
  for (const t of schedule.monthly) if (t.day === p.day) list.push(t);
  for (const t of schedule.yearly) if (t.month === p.month && t.day === p.day) list.push(t);
  const mapped = list.map((t) => ({
    ...t,
    startMin: hhmmToMin(t.time),
    endMin: hhmmToMin(t.time) + (t.window ?? 60)
  }));
  // 睡觉时段合成一条，让 nextTask 能提示「23:55 起睡觉」，也便于校验全天无缝铺满
  const span = (1440 - SLEEP.startMin) + SLEEP.endMin;
  mapped.push({
    time: SLEEP.start,
    name: SLEEP.label,
    type: 'Sleep',
    module: SLEEP.module,
    sleep: true,
    window: span,
    startMin: SLEEP.startMin,
    endMin: SLEEP.startMin + span
  });
  return mapped.sort((a, b) => a.startMin - b.startMin);
}

// 当前时刻命中的全部时段。同一时刻可能命中多条（两个模块共用一段），
// 所以活动模块是集合而不是单值；工作日与休息日各自一套网格。
export function activeTasks(tasks, nowMin) {
  return tasks.filter((t) => !t.sleep && t.startMin <= nowMin && nowMin < t.endMin);
}

// 当前时刻的主时段：取最后一条命中项，用于横幅「当前时段 X–Y · 模块名」
export function activeTask(tasks, nowMin) {
  const hits = activeTasks(tasks, nowMin);
  return hits.length ? hits[hits.length - 1] : null;
}

export function nextTask(tasks, nowMin) {
  return tasks.find((t) => t.startMin > nowMin) ?? null;
}

// 某一日某一刻「这个时间块归谁」——借调写入时用它记下 host_module（借入时段当时归哪个模块）。
// 记快照而不回溯重算：时段表将来改了，历史借调记录仍然如实反映当时挪进了谁的地盘。
// 取当日正午换算 zonedParts：服务时区固定东亚（UTC+8），正午前后 ±12h 必落在同一天。
export function hostModulesAt(dateKey, hhmm) {
  const s = String(hhmm ?? '');
  if (!isRealDate(dateKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return [];
  const probe = zonedParts(new Date(`${dateKey}T12:00:00+08:00`));
  const hits = activeTasks(todayTasks(probe), hhmmToMin(s));
  return hits.map((t) => t.module).filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
}

// ---------- 模块清单 ----------

// 模块集合固定，不随日型变化：模块完成率与支柱映射都按它遍历，
// 这样只在某些日型排班的模块，其他日子也能显示为「未建」，方便发现断档；
// cadence=none 的模块仍占一行，但不在目标体系里。
export function moduleList() {
  return [...MODULES];
}

// 当天时段表实际覆盖到的时段模块（按日型分流后的结果）
export function scheduledModules(p) {
  const seen = [];
  for (const t of todayTasks(p)) {
    if (t.module && !t.sleep && !seen.includes(t.module)) seen.push(t.module);
  }
  return seen;
}

// 全天无缝铺满自检（供 eval 调用）：只看「每日时段」网格（周/月/年任务是叠加在上面的仪式，
// 允许与网格重叠），检查从睡觉结束到睡觉开始之间无空档、无重叠，返回问题描述列表。
export function slotCoverageIssues(p) {
  const issues = [];
  const grid = todayTasks(p).filter(
    (t) => !t.sleep && t.dayOfWeek === undefined && t.day === undefined && t.month === undefined
  );
  let cursor = SLEEP.endMin;
  for (let i = 0; i < grid.length; ) {
    // 同一时刻起算的多条时段视为一组（两个模块共用一个时段时并列），
    // 组内不算重叠，取最晚终点继续往后推
    const start = grid[i].startMin;
    const names = [];
    let end = start;
    while (i < grid.length && grid[i].startMin === start) {
      end = Math.max(end, grid[i].endMin);
      names.push(grid[i].name);
      i += 1;
    }
    if (start > cursor) issues.push(`${minToHhmm(cursor)}–${minToHhmm(start)} 无时段覆盖`);
    else if (start < cursor) issues.push(`${minToHhmm(start)} ${names.join(' / ')} 与上一时段重叠`);
    cursor = Math.max(cursor, end);
  }
  if (grid.length && cursor !== SLEEP.startMin) {
    issues.push(`时段表在 ${minToHhmm(cursor)} 结束，与睡觉起点 ${SLEEP.start} 不衔接`);
  }
  return issues;
}

// 模块归属判断（统一入口）。三种历史写法都要兼容，任一处理不当都会让整组目标
// 在首页「当下该做什么」里消失（2026-10-14 首次修复）：
//   ① module 带括号后缀——「工作（深度）」这类写法
//   ② 时段模块带子业务线——「工作 开发」/「工作 运维」，需再按目标名区分两条线
//   ③ module 字段为空但目标名里写了模块名
export function goalInModule(goal, want) {
  if (!want) return false;
  const mod = baseModule(goal?.module);
  const name = String(goal?.name ?? '');
  const sub = subLineOf(want);
  if (sub) return mod === baseModule(want) && name.includes(sub);
  return mod === baseModule(want) || name.includes(want);
}

// 活动模块既可能是单值也可能是数组（多个模块共用一个时段）
function activeModuleList(activeModules) {
  if (!activeModules) return [];
  return Array.isArray(activeModules) ? activeModules.filter(Boolean) : [activeModules];
}

// 目标是否命中当前时段模块（任一命中即算对齐）
export function goalAligned(goal, activeModules) {
  return activeModuleList(activeModules).some((m) => goalInModule(goal, m));
}

// 小事（或任意 module 声明）与当前时段模块的归属比较：两边都归一后再比，
// 兼容「工作」与「工作 开发」混写；同属一个模块时子业务线必须一致。
export function moduleAligned(declared, activeModules) {
  const list = activeModuleList(activeModules);
  if (!declared || !list.length) return false;
  const b = baseModule(declared);
  return list.some((m) => {
    if (m === declared) return true;
    if (baseModule(m) !== b) return false;
    const sub = subLineOf(m);
    return sub ? String(declared).includes(sub) : true;
  });
}

// ---------- 优先级打分（百分制，只给目标打分） ----------
// score = base + priority + alignment + overdue，封顶 100。
// base: 当日目标 40；priority: P0+25 P1+15 P2+8 无+0；alignment: 命中当前时段模块 +25；
// overdue: +5/天 封顶 +20（日目标名称日期早于今天）。
// planning / review 是流程候选的固定分，用来压过普通目标。
export const SCORE = {
  base: 40,
  priority: { P0: 25, P1: 15, P2: 8, none: 0 },
  alignment: 25,
  planning: 85,
  review: 90,
  overduePerDay: 5,
  overdueCap: 20,
  max: 100
};

function priorityScore(p) {
  return SCORE.priority[p] ?? SCORE.priority.none;
}

// 日目标逾期天数：名字日期（今日(M/D)）早于今天
export function goalOverdueDays(goal, p) {
  const d = parseDayGoal(goal.name);
  if (!d) return 0;
  const year = d.month > p.month ? p.year - 1 : p.year;
  const end = new Date(Date.UTC(year, d.month - 1, d.day));
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const diff = Math.round((today - end) / 86_400_000);
  return diff > 0 ? diff : 0;
}

// 严格的 YYYY-MM-DD 判定：格式对 + 日期真实存在（挡掉 2026-10-32 / 2026-02-30 这类假日期）。
// 导出给 API 层复用，避免校验与打分两处口径漂移。
export function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function scoreGoal(goal, p, activeModules) {
  const aligned = goalAligned(goal, activeModules);
  const overdue = Math.min(goalOverdueDays(goal, p) * SCORE.overduePerDay, SCORE.overdueCap);
  const score = Math.min(SCORE.base + priorityScore(goal.priority) + (aligned ? SCORE.alignment : 0) + overdue, SCORE.max);
  return { score, aligned, overdueDays: goalOverdueDays(goal, p) };
}

// ---------- 主装配 ----------

// 目标名前缀（今日(11/13)· / 11月13日·）只用于引擎排序，展示时去掉
function stripPrefix(name) {
  return String(name ?? '')
    .replace(/^\d{4}年[·：:/／\s]*/, '')
    .replace(/^今日\(\d{1,2}\/\d{1,2}\)[·：:/／\s]*/, '')
    .replace(/^本周\([^)]*\)[·：:/／\s]*/, '')
    .replace(/^第?[一二三四1-4]?季度[·：:/／\s]*/, '')
    .replace(/^Q\d[·：:/／\s]*/, '')
    .replace(/^\d{1,2}月[：:·][\s]*/, '')
    .replace(/^\d{1,2}月\d{1,2}日[·：:/／\s]*/, '')
    .replace(/^[^-：:]*[-－]\s*/, '');
}

function dayGoalView(g) {
  return {
    id: g.id,
    name: g.name,
    task: stripPrefix(g.name) || g.name,
    module: g.module,
    priority: g.priority,
    status: g.status,
    plan: g.plan,
    kpi: g.kpi,
    parentId: g.parent_id
  };
}


// 时间分块是可选项：用户没表过态就沿用 profile 里的配置；表过态就按用户的来
export function timeBlocksSetting(db) {
  const raw = getMeta(db, 'time_blocks');
  if (raw === 'off') return { on: false, choice: 'off' };
  if (raw === 'on') return { on: true, choice: 'on' };
  // 用户自己分了模块 → 没有对应的时段表，默认就不分块
  if (userModules(db).custom) return { on: false, choice: 'unset' };
  return { on: PROFILE.schedule?.enabled !== false, choice: 'unset' };
}

export function buildNowPayload(db, now = new Date(), { awake = false } = {}) {
  const p = zonedParts(now);
  const tb = timeBlocksSetting(db);
  const timeBlocks = tb.on;
  const um = userModules(db);
  const cadenceOfUser = (name) => um.modules.find((m) => m.name === baseModule(name))?.cadence ?? 'weekly';
  // 不分块时没有时段表这回事：不判断睡觉、不筛模块，所有今日目标一视同仁
  const tasks = timeBlocks ? todayTasks(p) : [];
  const sleeping = timeBlocks ? isSleepingMin(p.minutesOfDay) : false;
  // 睡觉时段的「我醒了」入口：不绑定任何具体业务线，交给时段表决定
  const awakeFallback = { time: SLEEP.start, name: '自主安排', type: 'Do', module: null };
  const active = sleeping ? (awake ? awakeFallback : null) : activeTask(tasks, p.minutesOfDay);
  // 活动模块是集合：非工作日可能同时属于多个模块。周/月/年仪式叠加在每日网格上时以仪式为准，
  // 否则长网格会一直和仪式抢「当前模块」，凭空多出规划候选。
  const activeSlots = sleeping ? [] : activeTasks(tasks, p.minutesOfDay);
  const isRitual = (t) => t.dayOfWeek !== undefined || t.day !== undefined || t.month !== undefined;
  const ritualSlots = activeSlots.filter(isRitual);
  const gridSlots = activeSlots.filter((t) => !isRitual(t));
  // 日网格档被同模块仪式整段覆盖时，展示只留仪式行（覆盖判断只看窗口包含）
  const coveredByRitual = (t) =>
    !isRitual(t) &&
    !!t.module &&
    tasks.some((r) => isRitual(r) && r.module === t.module && r.startMin <= t.startMin && t.endMin <= r.endMin);
  const effectiveSlots = ritualSlots.length ? ritualSlots : gridSlots;
  const activeModules = (sleeping && awake ? [awakeFallback.module] : effectiveSlots.map((t) => t.module))
    .filter(Boolean)
    .filter((m, i, a) => a.indexOf(m) === i);
  const next = nextTask(tasks, p.minutesOfDay);
  const week = weekRange(p);

  // 只取本引擎用到的字段（去掉 do_note/check_note/act_note/change_log 等大字段，降低 payload）
  const all = db.prepare(
    'SELECT id, name, module, dimension, priority, status, plan, kpi, parent_id, created_at FROM goals'
  ).all();
  const byId = new Map(all.map((g) => [g.id, g]));
  const todayGoals = all.filter((g) => g.dimension === '日计划' && isToday(g, p));
  const weekGoals = all.filter((g) => g.dimension === '周计划' && isCurrentWeek(g, p));

  // ---- 现在该做什么：只有目标，没有"别的事" ----
  // 「现在该做」（ranked）只放当前时段模块的目标；不属于当前时段模块的今日目标不隐藏，
  // 而是降级进 offSlotGoals → 前端折叠区，保住可见性又不污染当前清单。
  const ranked = [];
  const offSlotGoals = [];
  // 可执行事项 = 全部今日目标 + 非日更模块（周更 / 不设目标）的本周目标
  const executable = [...todayGoals, ...weekGoals.filter((g) => cadenceOfUser(g.module) !== 'daily')];
  for (const g of executable) {
    if (!['进行中', '未完成'].includes(g.status)) continue;
    const s = scoreGoal(g, p, activeModules);
    if (!timeBlocks) s.aligned = true;
    (s.aligned ? ranked : offSlotGoals).push({
      source: 'pdca',
      id: g.id,
      name: g.name,
      task: dayGoalView(g).task,
      kpi: g.kpi,
      reason: timeBlocks
        ? (s.aligned ? '匹配当前时段，推进已制定的目标' : '不属于当前时段模块，今日仍要完成（收进折叠区，仅备查）')
        : null,
      module: g.module,
      priority: g.priority,
      status: g.status,
      score: s.score,
      aligned: s.aligned,
      overdueDays: s.overdueDays,
      createdAt: g.created_at ?? ''
    });
  }

  // 规划与复盘也是动作，只生成候选，不自动创建或更改目标
  for (const mod of activeModules) {
    if (!hasGoalCadence(mod)) continue;
    const matches = (g) => goalInModule(g, mod);
    const weekly = isWeeklyCadence(mod);
    const relevant = (weekly ? weekGoals : todayGoals).filter(matches);
    if (!relevant.length) {
      const parent = (weekly ? all.filter((g) => g.dimension === '月计划' && parseMonthGoal(g.name)?.month === p.month) : weekGoals)
        .find((g) => matches(g) && g.status === '进行中');
      ranked.push({
        source: 'planning',
        id: `plan-${mod}`,
        name: `立即设定${weekly ? '本周' : '今天'}的${mod}目标`,
        task: `立即设定${weekly ? '本周' : '今天'}的${mod}目标`,
        module: mod,
        priority: 'P0',
        status: '待制定',
        score: SCORE.planning,
        aligned: true,
        pinned: true,
        reason: `${mod} ${weekly ? '本周' : '今天'}还没有目标 · ${parent ? `可从上级拆解：${parent.plan || parent.name}` : '先花几分钟定下要做什么再行动'}`,
        createdAt: ''
      });
    } else if (active?.type === 'Check' && relevant.some((g) => ['进行中', '未完成'].includes(g.status))) {
      ranked.push({
        source: 'review',
        id: `review-${mod}`,
        name: `复盘${mod}${weekly ? '本周' : '今日'}目标`,
        task: `复盘${mod}${weekly ? '本周' : '今日'}目标`,
        module: mod,
        score: SCORE.review,
        priority: 'P0',
        status: '待复盘',
        aligned: true,
        reason: '已到 Check 时段，验收产出并确定下一步',
        createdAt: ''
      });
    }
  }
  if (active && ['回顾', '审视'].includes(active.type)) {
    ranked.push({
      source: 'review',
      id: `review-${active.name}`,
      name: active.name,
      task: active.name,
      module: null,
      score: SCORE.review,
      priority: 'P0',
      status: '待复盘',
      reason: active.type === '回顾' ? '回顾昨日执行情况，确认未完成项与下一步' : '检查本周期目标完成情况、偏移与目标链完整性',
      createdAt: ''
    });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.source !== b.source) {
      return ['review', 'planning', 'pdca'].indexOf(a.source) - ['review', 'planning', 'pdca'].indexOf(b.source);
    }
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
  });
  // 折叠区排序：按优先级，再按创建时间，保证刷新顺序稳定。不按分数排——折叠区拿不到 alignment 分
  offSlotGoals.sort(
    (a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
      a.id.localeCompare(b.id)
  );

  // 模块状态按 profile 的模块清单固定遍历（不随日型变化）：非当日排班的模块也显示为「未建」，方便发现断档
  const todayScheduled = scheduledModules(p);
  const modules = um.modules.map((m) => m.name).map((mod) => {
    const goals = todayGoals
      .filter((g) => goalInModule(g, mod))
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .map(dayGoalView);
    return {
      module: mod,
      pillar: PILLAR_OF[mod] ?? null,
      scheduledToday: todayScheduled.some((s) => baseModule(s) === mod),
      hasTodayGoal: goals.length > 0,
      goals
    };
  });

  // 未归属到任何模块的今日目标（防遗漏）
  const assigned = new Set(modules.flatMap((m) => m.goals.map((g) => g.id)));
  const others = todayGoals
    .filter((g) => !assigned.has(g.id))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .map(dayGoalView);
  if (others.length) modules.push({ module: '其他', hasTodayGoal: true, goals: others });

  const focus = todayGoals
    .filter((g) => g.status !== '已完成')
    .sort((a, b) => {
      const d = priorityRank(a.priority) - priorityRank(b.priority);
      if (d !== 0) return d;
      return (a.status === '未完成' ? 0 : 1) - (b.status === '未完成' ? 0 : 1);
    })
    .slice(0, 5)
    .map(dayGoalView);

  const recommendation = sleeping && !awake
    ? { source: 'sleep', task: '现在，安心睡眠', reason: `${SLEEP.start}–${SLEEP.end} 是睡眠时间，明早再继续。`, score: null }
    : ranked[0] ?? { source: 'idle', task: '当前事项已处理完', reason: '可以休息，或到 Plan 查看后续安排。', score: null };
  const advice = { headline: recommendation.task, detail: recommendation.reason };

  return {
    currentGoalIds: all.filter((g) => {
      if (g.dimension === '日计划') return isToday(g, p);
      if (g.dimension === '周计划') return isCurrentWeek(g, p);
      if (g.dimension === '月计划') return parseMonthGoal(g.name)?.month === p.month;
      if (g.dimension === '季度计划') {
        const q = Math.ceil(p.month / 3);
        return new RegExp(`^(?:Q${q}|第${q}季度)`).test(g.name);
      }
      if (g.dimension === '年计划') return g.name.startsWith(`${p.year}年`);
      return g.dimension === '三年计划' && g.status === '进行中';
    }).map((g) => g.id),
    sleeping,
    awake,
    timeBlocks,
    timeBlockChoice: tb.choice,
    recommendation,
    serverTime: now.toISOString(),
    today: {
      dateLabel: p.dateLabel,
      weekday: p.weekday,
      weekLabel: week,
      monthLabel: `${p.month}月`,
      dayType: p.dayType,
      dayTypeLabel: p.dayTypeLabel,
      holiday: p.holiday,
      calendarCoverage: p.calendarCoverage
    },
    sleep: { start: SLEEP.start, end: SLEEP.end, module: SLEEP.module, label: SLEEP.label, tip: SLEEP.tip },
    // to = 该时段自身窗口的终点（跨零点取模回 00:00），不能拿下一条的起点：
    // 周/月/年仪式只占自己的窗口，用下一条起点会把 60 分钟的仪式一路拉成整个下午
    activeTask: active
      ? {
          time: active.time,
          to: active.endMin != null ? minToHhmm(active.endMin % 1440) : null,
          name: active.name,
          type: active.type,
          module: active.module,
          modules: activeModules
        }
      : null,
    activeModules,
    // 当天生效的时段条（含睡觉段），按时间排好序，便于前端与 Agent 直接展示/核对
    todaySlots: tasks.filter((t) => !coveredByRitual(t)).map((t) => ({
      time: t.time,
      to: minToHhmm(t.endMin % 1440),
      name: t.name,
      type: t.type,
      module: t.module,
      sleep: !!t.sleep
    })),
    nextTask: next ? { time: next.time, name: next.name, type: next.type, module: next.module } : null,
    advice,
    focus,
    moduleStatus: modules,
    weekGoals: weekGoals
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .map((g) => ({
        id: g.id,
        name: g.name,
        module: g.module,
        priority: g.priority,
        status: g.status,
        plan: g.plan,
        kpi: g.kpi,
        parentName: (() => {
          const pid = String(g.parent_id ?? '').split(';')[0];
          return pid ? byId.get(pid)?.name ?? null : null;
        })()
      })),
    todayStats: {
      total: todayGoals.length,
      done: todayGoals.filter((g) => g.status === '已完成').length
    },
    ranked,
    // 非当前时段模块的今日目标：由前端收进折叠区
    offSlotGoals,
    scoreRules: SCORE,
    // 全库目标总数：前端据此判断是不是「首次上手」（0 条时显示三步引导）
    goalCount: all.length
  };
}
