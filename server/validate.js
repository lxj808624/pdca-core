// 规则硬校验引擎：把 PDCA Skill 的核心原则代码化，Agent 违规写入直接拦截
// 规则来源：agent/skills/pdca/SKILL.md 核心原则 1-11
import { parseDayGoal, parseWeekGoal, parseMonthGoal } from './now.js';
import { MODULES, SUBLINES_OF, SLOT_MODULES, baseModule } from './modules.js';
import { DIMENSIONS, STATUSES, PRIORITIES, RULES, ancestorDims, PARENT_DIM } from './profile.js';

// 世界观全部来自 profile：维度 / 状态 / 优先级 / 主线上限 / 是否强制子业务线分离
export { MODULES, DIMENSIONS, STATUSES, PRIORITIES, RULES };

// parent_id 支持分号拼接的多上级（与飞书导入的历史数据格式一致）；单个 id 也合法
export function splitParentIds(parentId) {
  return String(parentId ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// 从维度链中位于 dim 之上的所有维度：统一由 profile 的 dimensions 顺序推导

// 周期标识：同一模块同一周期内的目标视为同一"主线组"
export function periodKeyOf(goal) {
  const n = goal.name || '';
  switch (goal.dimension) {
    case '日计划': {
      const d = parseDayGoal(n);
      return d ? `d:${d.month}/${d.day}` : '__none__';
    }
    case '周计划': {
      const w = parseWeekGoal(n);
      return w ? `w:${w.startKey}-${w.endKey}` : '__none__';
    }
    case '月计划': {
      const m = parseMonthGoal(n);
      return m ? `m:${m.month}` : '__none__';
    }
    case '季度计划': {
      const q = n.match(/^Q(\d)(?:季度)?/);
      return q ? `q:${q[1]}` : '__none__';
    }
    case '年计划': {
      const y = n.match(/^(\d{4})年/);
      return y ? `y:${y[1]}` : '__none__';
    }
    case '三年计划': {
      const y = n.match(/^(\d{4})年/);
      return y ? `t:${y[1]}` : '__none__';
    }
    default:
      return '__none__';
  }
}

/**
 * 子业务线识别（按 profile 的 subLines 通用化）：
 * 带 subLines 的模块在名称里必须标明子业务线，各子业务线独立占主线名额。
 * 名称同时含多个关键词时，取先出现的那个，保证判定确定、可解释。
 * 无子业务线的模块返回 null（所有目标同属一组）。
 */
export function subModuleOf(goal) {
  // goal.module 可能是「工作 开发」这类时段写法，先归一到模块基名
  const subs = SUBLINES_OF[baseModule(goal?.module)] ?? [];
  if (!subs.length) return null;
  const n = String(goal.name ?? '');
  let best = null;
  let bestIdx = Infinity;
  for (const s of subs) {
    const i = n.indexOf(s);
    if (i !== -1 && i < bestIdx) { best = s; bestIdx = i; }
  }
  return best;
}

/** 子业务线校验：返回错误文案或 null（规则强度由 profile.rules.subLineSplit 控制） */
function subLineError(module, name, mods = null) {
  const subs = mods
    ? (mods.find((m) => m.name === baseModule(module))?.subLines ?? [])
    : (SUBLINES_OF[baseModule(module)] ?? []);
  if (!RULES.subLineSplit || !subs.length) return null;
  if (subs.some((s) => String(name ?? '').includes(s))) return null;
  return `${module} 必须区分子业务线：目标名称需包含「${subs.join('」或「')}」，禁止合并为笼统目标`;
}


/** 同一条"主线组"：同模块 + 同子模块 + 同维度 + 同周期 */
export function sameMainlineGroup(a, b) {
  return (
    a.module === b.module &&
    a.dimension === b.dimension &&
    subModuleOf(a) === subModuleOf(b) &&
    periodKeyOf(a) === periodKeyOf(b)
  );
}

/** 组标签，用于错误/提示文案（带子线的模块要带上子线，避免说不清） */
function groupLabel(goal) {
  const sub = subModuleOf(goal);
  return `${goal.module}${sub ? `·${sub}` : ''}·${goal.dimension}·${periodKeyOf(goal)}`;
}

function expectedPrioritySet(n) {
  return PRIORITIES.slice(0, Math.min(n, PRIORITIES.length));
}

/**
 * 创建目标校验。返回 { ok, status, errors, warnings }
 * errors → 拦截（HTTP 400/409）；warnings → 放行但提示
 */
export function validateCreate(db, g, mods = null) {
  const errors = [];
  const warnings = [];

  if (!g.name || !String(g.name).trim()) errors.push('目标名称必填');
  if (!DIMENSIONS.includes(g.dimension)) errors.push(`时间维度必须是 ${DIMENSIONS.join('/')}`);
  if (RULES.requirePriority) {
    if (!g.priority) errors.push(`优先级必填（无优先级→拦截）：${PRIORITIES.join('/')}`);
    else if (!PRIORITIES.includes(g.priority)) errors.push(`优先级只能是 ${PRIORITIES.join('/')}`);
  } else if (g.priority && !PRIORITIES.includes(g.priority)) {
    errors.push(`优先级只能是 ${PRIORITIES.join('/')}`);
  }
  // 模块值域 = 模块基名 ∪ 时段模块（带子业务线的写法，如「工作 开发」）
  const allowed = mods
    ? new Set(mods.flatMap((m) => [m.name, ...(m.subLines ?? []).map((s) => `${m.name} ${s}`)]))
    : new Set([...MODULES, ...SLOT_MODULES]);
  if (!allowed.has(g.module)) errors.push(`模块必须是 ${[...allowed].join('/')}`);

  if (errors.length) return { ok: false, status: 400, errors, warnings };

  // 规则9：子业务线强制分离（按 profile 的 subLines 通用化）
  const subErr = subLineError(g.module, g.name, mods);
  if (subErr) errors.push(subErr);

  // 规则1：目标链完整性——父目标必须存在且为上级维度（支持分号多上级，逐个校验）
  if (g.parent_id) {
    for (const pid of splitParentIds(g.parent_id)) {
      const parent = db.prepare('SELECT * FROM goals WHERE id = ?').get(pid);
      if (!parent) {
        errors.push(`上级目标不存在（${pid}）：目标链不允许断裂，请先建立上级目标`);
      } else if (!ancestorDims(g.dimension).includes(parent.dimension)) {
        errors.push(
          `上级目标维度必须是上层周期：${g.dimension} 的父目标不能是「${parent.dimension}」（规则：目标链逐级建立）`
        );
      }
    }
  } else if (g.dimension !== '三年计划') {
    warnings.push(`未关联上级目标：${g.dimension} 建议关联 Parent Goal，保持目标链完整`);
  }

  // 规则3/5：主线数量（同模块+同子模块+同维度+同周期，进行中）
  const siblings = db
    .prepare("SELECT * FROM goals WHERE module = ? AND dimension = ? AND status = '进行中'")
    .all(g.module, g.dimension)
    .filter((s) => sameMainlineGroup(s, g));
  if (siblings.length >= RULES.mainlineLimit) {
    errors.push(
      `超${RULES.mainlineLimit}条主线：${groupLabel(g)} 已有 ${siblings.length} 条进行中目标（规则：最多${RULES.mainlineLimit}条，超出请顺延，保留 ${PRIORITIES.join('/')} Top${RULES.mainlineLimit}）`,
      `现有主线：${siblings.map((s) => `${s.priority ?? '?'} ${s.name}`).join('；')}`
    );
  }

  // 规则4：优先级映射（组内含新目标的优先级集合必须是 P0 起的前缀递增）
  const prioSet = [...new Set([...siblings.map((s) => s.priority), g.priority])].sort();
  const expected = expectedPrioritySet(siblings.length + 1);
  if (!expected.every((p) => prioSet.includes(p)) || prioSet.some((p) => !expected.includes(p))) {
    warnings.push(
      `优先级映射建议：${siblings.length + 1} 条主线应为 ${expected.join('+')}，当前组内为 ${prioSet.join('+')}，请从 P0 重排`
    );
  }

  return { ok: errors.length === 0, status: errors.length ? 409 : 200, errors, warnings };
}

/**
 * 更新目标校验（PATCH）。返回 { ok, status, errors, warnings, changes }
 */
export function validateUpdate(db, existing, patch, mods = null) {
  const errors = [];
  const warnings = [];
  const changes = {};

  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    errors.push(`状态只能是 ${STATUSES.join('/')}`);
  }
  if (patch.priority !== undefined && !PRIORITIES.includes(patch.priority)) {
    errors.push(`优先级只能是 ${PRIORITIES.join('/')}`);
  }
  if (patch.module !== undefined && mods) {
    const allowed = new Set(mods.flatMap((m) => [m.name, ...(m.subLines ?? []).map((s) => `${m.name} ${s}`)]));
    if (!allowed.has(patch.module)) errors.push(`模块必须是 ${[...allowed].join('/')}`);
  }
  if (patch.name !== undefined && !String(patch.name).trim()) {
    errors.push('目标名称不能为空');
  }

  const next = { ...existing, ...patch };

  // 规则9：子业务线名称检查（改名时）
  const subErr2 = patch.name !== undefined ? subLineError(next.module, next.name, mods) : null;
  if (subErr2) errors.push(subErr2);

  // 规则1：父目标检查（改挂载时，支持分号多上级，逐个校验）
  if (patch.parent_id !== undefined && patch.parent_id) {
    for (const pid of splitParentIds(patch.parent_id)) {
      const parent = db.prepare('SELECT * FROM goals WHERE id = ?').get(pid);
      if (!parent) errors.push(`上级目标不存在（${pid}）`);
      else if (!ancestorDims(next.dimension).includes(parent.dimension)) {
        errors.push(`父目标维度不合法：${next.dimension} 的父目标不能是「${parent.dimension}」`);
      }
    }
  }

  // 规则4：优先级变更后组内映射提示
  if (patch.priority !== undefined && patch.priority !== existing.priority) {
    const siblings = db
      .prepare("SELECT * FROM goals WHERE module = ? AND dimension = ? AND status = '进行中' AND id != ?")
      .all(existing.module, existing.dimension, existing.id)
      .filter((s) => sameMainlineGroup(s, existing));
    const prioSet = [...new Set([...siblings.map((s) => s.priority), patch.priority])].sort();
    const expected = expectedPrioritySet(siblings.length + 1);
    if (prioSet.some((p) => !expected.includes(p))) {
      warnings.push(
        `优先级映射建议：组内 ${siblings.length + 1} 条主线应为 ${expected.join('+')}，当前为 ${prioSet.join('+')}，请从 P0 重排`
      );
    }
    changes.priority = `${existing.priority ?? '无'} → ${patch.priority}`;
  }

  for (const k of ['status', 'name', 'plan', 'kpi', 'check_note', 'act_note', 'do_note', 'parent_id', 'est_effort']) {
    if (patch[k] !== undefined && patch[k] !== existing[k]) {
      if (k === 'name') changes.name = `${existing.name} → ${patch.name}`;
      else if (k === 'status') changes.status = `${existing.status ?? '无'} → ${patch.status}`;
      else changes[k] = 'updated';
    }
  }

  return { ok: errors.length === 0, status: errors.length ? 400 : 200, errors, warnings, changes };
}

// 生成 Change Log 追加文本
export function appendChangeLog(existingLog, changes, note) {
  const parts = [];
  const day = new Date().toISOString().slice(0, 10);
  if (changes.status) parts.push(`状态 ${changes.status}`);
  if (changes.priority) parts.push(`优先级 ${changes.priority}`);
  if (changes.name) parts.push(`改名（${changes.name}）`);
  const fieldUpdates = Object.keys(changes).filter((k) => !['status', 'priority', 'name'].includes(k));
  if (fieldUpdates.length) parts.push(`更新 ${fieldUpdates.join('/')}`);
  if (!parts.length && !note) return existingLog ?? null;
  const line = `[${day}] ${note ? note + (parts.length ? '：' : '') : ''}${parts.join('；')}`;
  return existingLog ? `${existingLog}\n${line}` : line;
}
