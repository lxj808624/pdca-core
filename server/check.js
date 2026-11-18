// Check 页聚合数据：完成率、偏差检测、复盘时间线
// 复用 now.js 的当下引擎产物，偏差规则与 validate.js / check.sh 保持一致
import { buildNowPayload, todayTasks, zonedParts, goalInModule, timeBlocksSetting } from './now.js';
import { userModules } from './usermodules.js';
import { SUBLINES_OF, baseModule, isWeeklyCadence, cadenceOf, hasGoalCadence } from './modules.js';
import { sameMainlineGroup, subModuleOf } from './validate.js';
import { tr, labelOf } from './i18n.js';

export function buildCheckPayload(db, date = new Date(), lang = 'zh') {
  const trr = (zh, en) => tr(lang, zh, en);
  const now = buildNowPayload(db, date, { lang });
  // 看全天日排班，不受当前时段或周/月/年仪式覆盖影响；周更模块不催建日目标。
  // 「周更」按 modules.js 的 cadence 判定，不看当天有没有日网格档：
  // 周更模块排的网格是执行周目标的时间块，最小周期是周。
  // cadence=none 的模块同样不催：它仍在时段表里，但不进目标体系，
  // 既不算 missing 也不显示「未建」。
  const um = userModules(db);
  // 不分块 / 用户自己分模块时没有「时段表」这回事，也就不存在「某模块今天没建日目标」
  const useGrid = !um.custom && timeBlocksSetting(db).on;
  const dailyModules = !useGrid ? [] : [...new Set(todayTasks(zonedParts(date))
    .filter((t) => t.type === 'Plan' && t.module &&
      t.dayOfWeek === undefined && t.day === undefined && t.month === undefined &&
      hasGoalCadence(t.module) && !isWeeklyCadence(t.module))
    .map((t) => t.module))];
  const todayGoals = now.moduleStatus.flatMap((m) => m.goals);
  const missingModules = dailyModules.filter((mod) => !todayGoals.some((g) => goalInModule(g, mod)));

  // 模块完成率（今日）：moduleStatus 覆盖全部模块，支柱映射直接命中
  const moduleRates = now.moduleStatus.map((m) => {
    const total = m.goals.length;
    const done = m.goals.filter((g) => g.status === '已完成').length;
    return {
      module: m.module, pillar: m.pillar ?? um.modules.find((x) => x.name === baseModule(m.module))?.pillar ?? null, total, done,
      // cadence：模块最小周期（modules.js 三态）。周更模块的完成率按周看，
      // 前端据此显示「周更 · 按周验收」；none 模块不设目标，显示「不设目标」。
      cadence: um.modules.find((x) => x.name === baseModule(m.module))?.cadence ?? cadenceOf(m.module),
      hasTodayGoal: m.hasTodayGoal,
      dailyGoalRequired: dailyModules.some((mod) => baseModule(mod) === m.module),
      missingDailyModules: missingModules.filter((mod) => baseModule(mod) === m.module)
    };
  });

  // 偏差检测（与硬校验规则同源，针对存量/历史数据）
  const deviations = [];

  if (missingModules.length) {
    deviations.push({
      level: 'warn',
      type: trr('今日目标未建', 'Missing daily goal'),
      detail: trr(`${missingModules.map((m) => labelOf(lang, m)).join('、')} 今日尚无日目标，请在对应 Plan 时段补建`, `No daily goal yet for ${missingModules.map((m) => labelOf(lang, m)).join(', ')}; add one in the matching Plan block`)
    });
  }

  // 复用写接口的分组规则：模块 + 子模块 + 维度 + 周期，P0/P1/P2 都占名额。
  const weekGroups = [];
  for (const g of now.weekGoals.filter((g) => g.status === '进行中')) {
    const goal = { ...g, dimension: '周计划' };
    const group = weekGroups.find((items) => sameMainlineGroup(items[0], goal));
    if (group) group.push(goal);
    else weekGroups.push([goal]);
  }
  for (const group of weekGroups.filter((items) => items.length > 3)) {
    const sub = subModuleOf(group[0]);
    const label = `${group[0].module}${sub ? `·${sub}` : ''}`;
    deviations.push({
      level: 'warn',
      type: trr('主线超标', 'Too many active goals'),
      detail: trr(`${label} 本周同周期进行中的主线有 ${group.length} 条（上限 3）：${group.map((g) => g.name).join('、')}，建议顺延低优先级项`, `${label} has ${group.length} active goals this week (limit 3): ${group.map((g) => g.name).join(', ')}. Move a lower-priority item to next week`)
    });
  }

  // 子业务线缺失检测（按 profile 的 subLines 通用化）
  for (const mod of Object.keys(SUBLINES_OF)) {
    const subs = SUBLINES_OF[mod];
    if (!subs.length) continue;
    const rows = db.prepare("SELECT id, name FROM goals WHERE module = ? AND status = '进行中'").all(mod);
    const mixed = rows.filter((g) => !subs.some((s) => String(g.name).includes(s))).slice(0, 5);
    if (mixed.length) {
      deviations.push({
        level: 'warn',
        type: trr(`${labelOf(lang, mod)} 子业务线缺失`, `${labelOf(lang, mod)} sub-line missing`),
        detail: trr(`${mixed.length} 条进行中目标未区分子业务线：${mixed.map((g) => g.name).join('、')}`, `${mixed.length} active goal(s) do not name a sub-line: ${mixed.map((g) => g.name).join(', ')}`)
      });
    }
  }

  // 复盘时间线：最近有 Check/Act 记录的目标
  const reviewTimeline = db.prepare(`
    SELECT id, name, module, dimension, status, check_note, act_note, change_log, updated_at
    FROM goals
    WHERE (check_note IS NOT NULL AND check_note != '')
       OR (act_note IS NOT NULL AND act_note != '')
    ORDER BY updated_at DESC
    LIMIT 20
  `).all();

  return {
    serverTime: now.serverTime,
    today: now.today,
    todayStats: now.todayStats,
    weekLabel: now.today.weekLabel,
    weekStats: {
      total: now.weekGoals.length,
      done: now.weekGoals.filter((g) => g.status === '已完成').length
    },
    weekGoals: now.weekGoals,
    moduleRates,
    deviations,
    reviewTimeline
  };
}
