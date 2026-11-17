// 模块口径的对外出口 —— 全部从 profile 派生，本文件不再持有任何具体模块名。
//
// 两种口径：
//   MODULES      —— 目标 module 字段的值域（profile.modules 的 name 列表）
//   SLOT_MODULES —— 时段模块：带 subLines 的模块会展开成多个子业务线（如 工作 → 开发 / 运维）
//
// 兼容旧代码的 import 面：now.js / validate.js / check.js / index.js 都从这里取，
// 所以换 profile 不需要改任何调用方。
import { MODULES_DEF } from './profile.js';

export const MODULES = MODULES_DEF.map((m) => m.name);

/** 模块 → 子业务线列表（无子业务线的模块为空数组） */
export const SUBLINES_OF = MODULES_DEF.reduce((acc, m) => {
  acc[m.name] = Array.isArray(m.subLines) ? m.subLines : [];
  return acc;
}, {});

/** 时段模块：子业务线展开后的扁平列表，用于时段表与小事的归属 */
export const SLOT_MODULES = MODULES_DEF.flatMap((m) => {
  const subs = SUBLINES_OF[m.name] ?? [];
  return subs.length ? subs.map((s) => `${m.name} ${s}`) : [m.name];
});

/** 支柱映射：模块 → 支柱 key */
export const PILLAR_OF = MODULES_DEF.reduce((acc, m) => {
  if (m.pillar) acc[m.name] = m.pillar;
  return acc;
}, {});

/** 模块目标周期（最小周期）三态：daily 日更 / weekly 周更 / none 不设目标 */
export const CADENCE = MODULES_DEF.reduce((acc, m) => {
  acc[m.name] = m.cadence ?? 'daily';
  return acc;
}, {});

/** 归一化任意历史写法到 profile 的模块名：
 *  「工作（深度）」→ 去掉括号后缀；「工作 开发」→ 归到 工作 */
export function baseModule(v) {
  const s = String(v ?? '').replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  for (const m of MODULES_DEF) {
    if (s === m.name) return m.name;
    const subs = SUBLINES_OF[m.name] ?? [];
    if (subs.some((sub) => s === `${m.name} ${sub}`)) return m.name;
  }
  return s;
}

/** 取时段模块的子业务线名（工作 开发 → 开发），非子业务线返回 null */
export function subLineOf(slot) {
  const s = String(slot ?? '');
  for (const m of MODULES_DEF) {
    const subs = SUBLINES_OF[m.name] ?? [];
    for (const sub of subs) if (s === `${m.name} ${sub}`) return sub;
  }
  return null;
}

/** 归一化后的 cadence 值；未登记的模块按日更 */
export function cadenceOf(v) {
  return CADENCE[baseModule(v)] || 'daily';
}

/** 是否周更周期 */
export function isWeeklyCadence(v) {
  return cadenceOf(v) === 'weekly';
}

/** 是否还在目标体系内（none = 已停止立目标，只保留时段与栏目） */
export function hasGoalCadence(v) {
  return cadenceOf(v) !== 'none';
}
