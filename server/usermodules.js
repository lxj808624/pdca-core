// 使用者自己的模块划分（存 meta.modules，跟库走）
//
// 三种形态：
//   · 没设置         → 用 profile 默认模块（自托管 / 个人版保持原样）
//   · 设置为 []      → 单清单：不划分模块，所有目标挂在一个桶里
//   · 设置为 [{name}] → 用户自己起的几个模块
import { MODULES_DEF } from './profile.js';
import { getMeta, setMeta } from './db.js';

export const SINGLE_MODULE = '目标';

const DEFAULT_RESULT = { modules: MODULES_DEF, custom: false, single: false };

export function userModules(db) {
  const raw = getMeta(db, 'modules');
  if (raw === null) return DEFAULT_RESULT;
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return DEFAULT_RESULT;
  }
  if (!Array.isArray(arr) || !arr.length) {
    return { modules: [{ name: SINGLE_MODULE, cadence: 'weekly' }], custom: true, single: true };
  }
  const modules = arr
    .map((m) => (typeof m === 'string' ? { name: m } : m))
    .filter((m) => m && String(m.name ?? '').trim())
    .map((m) => ({ name: String(m.name).trim(), cadence: ['daily', 'weekly', 'none'].includes(m.cadence) ? m.cadence : 'weekly' }));
  if (!modules.length) return { modules: [{ name: SINGLE_MODULE, cadence: 'weekly' }], custom: true, single: true };
  return { modules, custom: true, single: modules.length === 1 && modules[0].name === SINGLE_MODULE };
}

/** 保存用户模块；names 为空数组 = 单清单 */
export function setUserModules(db, names) {
  setMeta(db, 'modules', JSON.stringify(names));
}

/** 校验用：允许的模块值域（含带子业务线的写法） */
export function allowedModules(modules) {
  const names = new Set();
  for (const m of modules) {
    names.add(m.name);
    for (const sub of m.subLines ?? []) names.add(`${m.name} ${sub}`);
  }
  return names;
}
