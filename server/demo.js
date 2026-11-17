// 演示数据：按「今天」生成一套当前周期的目标，用于 toC 用户注册后一键看到效果。
//
// 和 `npm run seed:demo` 是同一套数据（CLI 走 seed.js，网页走 POST /api/demo），
// 差别只是落库对象：CLI 用默认库，网页用当前登录用户的库。
//
// 引擎规则决定了这套数据的写法：
//   · 目标名必须带周期前缀（年 / Q / 月 / 本周 / 今日），否则不会出现在「当下」；
//   · 模块带子业务线时，日目标名称里必须出现子业务线词，否则会被判成「不属于当前时段」；
//   · 日目标尽量落在此刻正在排班的模块上，导入后立刻能在首屏看见。
import { zonedParts, weekRange, hostModulesAt } from './now.js';
import { PROFILE } from './profile.js';

const demoIdOf = (key) => `demo-${key}`;

/**
 * 生成 7 条演示目标（年 / 季 / 月 / 周 / 3 条日），已按 SQL 字段命名好。
 * moduleNames 传了就用它（浏览器里选过模块的用户），否则用 profile 的模块。
 * 没有任何时段表 / 模块不匹配时也不炸：日目标退回到第一个模块。
 */
export function demoRows(now = new Date(), moduleNames = null) {
  const p = zonedParts(now);
  const wk = weekRange(p);
  const q = Math.floor((p.month - 1) / 3) + 1;
  const mods = moduleNames?.length ? moduleNames : PROFILE.modules.map((m) => m.name);
  const pick = (i) => mods[i % mods.length] ?? '默认模块';

  const dateKey = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const active = hostModulesAt(dateKey, `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`)[0];
  // 时段表里的模块可能不属于当前用户的模块（自定义模块时），不匹配就退回第一个
  const dayMod = active && mods.some((n) => String(active).startsWith(n)) ? active : pick(0);
  const owner = PROFILE.modules.find((m) => String(dayMod).startsWith(m.name));
  const subWord = (owner?.subLines ?? [])[0] ?? '';
  const dayTag = subWord ? `${subWord} ` : '';

  const iso = now.toISOString();
  const base = { status: '进行中', created_at: iso, updated_at: iso, change_log: `[${iso.slice(0, 10)}] 导入演示数据`,
    do_note: null, check_note: null, act_note: null, est_effort: null };

  return [
    { id: demoIdOf('year'), name: `${p.year}年·跑通核心版`, module: pick(0), dimension: '年计划', priority: 'P0', parent_id: null,
      plan: '用这套系统管住自己的目标链', kpi: '连续两周每天都有日目标', ...base },
    { id: demoIdOf('quarter'), name: `Q${q}·把日常用起来`, module: pick(0), dimension: '季度计划', priority: 'P1', parent_id: demoIdOf('year'),
      plan: '每天 5 分钟立目标，每周复盘一次', kpi: '周复盘不断档', ...base },
    { id: demoIdOf('month'), name: `${p.month}月：熟悉这套系统`, module: pick(0), dimension: '月计划', priority: 'P1', parent_id: demoIdOf('quarter'),
      plan: '把三页都点一遍，建一条自己的目标', kpi: '能自己讲清当下页的排序逻辑', ...base },
    { id: demoIdOf('week'), name: `本周(${wk})·三页都看一遍`, module: pick(0), dimension: '周计划', priority: 'P0', parent_id: demoIdOf('month'),
      plan: '当下 / 目标链 / 复盘 各打开一次', kpi: '三页都能正常渲染', ...base },
    { id: demoIdOf('day-1'), name: `今日(${p.month}/${p.day})·${dayTag}跑通本地实例`, module: dayMod, dimension: '日计划', priority: 'P0', parent_id: demoIdOf('week'),
      status: '已完成', ...base, plan: 'npm install && npm run build && npm start', kpi: '/api/health 返回 ok',
      do_note: '照 README 跑通，8 分钟', check_note: '三页均可打开' },
    { id: demoIdOf('day-2'), name: `今日(${p.month}/${p.day})·${dayTag}读一遍 Agent Skill`, module: dayMod, dimension: '日计划', priority: 'P1', parent_id: demoIdOf('week'),
      ...base, plan: '读 SKILL.md 的命名规范与写入字段', kpi: '能用一句话说明流程' },
    { id: demoIdOf('day-3'), name: `今日(${p.month}/${p.day})·${dayTag}写三条今天的日目标`, module: dayMod, dimension: '日计划', priority: 'P2', parent_id: demoIdOf('week'),
      ...base, plan: '按 今日(M/D)·… 的格式命名', kpi: '三条都出现在当下页' }
  ];
}

/**
 * 往指定库里写演示数据（幂等 upsert）。
 * 已经导过就默认不再覆盖（用户可能改了状态），force=true 才重写。
 */
export function seedDemo(db, { now = new Date(), force = false, modules = null } = {}) {
  const rows = demoRows(now, modules);
  const existing = db.prepare("SELECT COUNT(*) AS n FROM goals WHERE id LIKE 'demo-%'").get().n;
  if (existing > 0 && !force) return { ok: false, reason: 'already-seeded', existing, total: rows.length };

  const upsert = db.prepare(`
    INSERT INTO goals (id, name, module, dimension, priority, status, parent_id, plan, kpi,
                       do_note, check_note, act_note, est_effort, change_log, created_at, updated_at)
    VALUES (@id, @name, @module, @dimension, @priority, @status, @parent_id, @plan, @kpi,
            @do_note, @check_note, @act_note, @est_effort, @change_log, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, module=excluded.module, dimension=excluded.dimension,
      priority=excluded.priority, status=excluded.status, parent_id=excluded.parent_id,
      plan=excluded.plan, kpi=excluded.kpi, change_log=excluded.change_log, updated_at=excluded.updated_at
  `);

  db.exec('BEGIN');
  try {
    for (const r of rows) upsert.run(r);
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('seededAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(now.toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const byDimension = {};
  for (const r of rows) byDimension[r.dimension] = (byDimension[r.dimension] ?? 0) + 1;
  return { ok: true, inserted: rows.length, byDimension, ids: rows.map((r) => r.id) };
}
