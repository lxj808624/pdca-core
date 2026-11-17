// 世界观加载层（单一事实源）
//
// 为什么要有这一层：完整版系统把「模块 / 支柱映射 / 模块节奏 / 时段表 / 校验强度」
// 全部写死在模块代码里，换个用户就得改源码。这里把它们收进 profile/*.json：
//   - 默认读 profile/default.json
//   - 也可用环境变量 PDCA_PROFILE 指向任意绝对路径（一台机器跑多套体系）
//   - 所有派生口径（SLOT_MODULES / PILLAR_OF / CADENCE / 维度父子链）都从这里算
//
// 约定：profile 只描述「这个世界怎么运作」，不含任何个人数据；个人数据永远在 SQLite。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function resolveProfilePath() {
  const custom = process.env.PDCA_PROFILE;
  if (custom) return path.isAbsolute(custom) ? custom : path.join(ROOT, custom);
  return path.join(ROOT, 'profile', 'default.json');
}

const PROFILE_PATH = resolveProfilePath();
const raw = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));

/** 校验 profile 结构，早点炸比运行时 undefined 好 */
function assertProfile(p) {
  if (!Array.isArray(p.modules) || !p.modules.length) throw new Error('profile.modules 必须是非空数组');
  if (!Array.isArray(p.dimensions) || !p.dimensions.length) throw new Error('profile.dimensions 必须是非空数组');
  if (!Array.isArray(p.priorities) || !p.priorities.length) throw new Error('profile.priorities 必须是非空数组');
  const pillarKeys = new Set((p.pillars ?? []).map((x) => x.key));
  for (const m of p.modules) {
    if (!m.name) throw new Error('profile.modules 每项必须有 name');
    if (m.pillar && !pillarKeys.has(m.pillar)) throw new Error(`模块 ${m.name} 的 pillar「${m.pillar}」未在 pillars 中声明`);
    if (m.cadence && !['daily', 'weekly', 'none'].includes(m.cadence)) {
      throw new Error(`模块 ${m.name} 的 cadence 只能是 daily/weekly/none`);
    }
  }
  if (!p.schedule?.daily?.length) throw new Error('profile.schedule.daily 必须是非空数组');
  if (!p.schedule?.sleep?.start || !p.schedule?.sleep?.end) throw new Error('profile.schedule 缺少 sleep.start/end');
}
assertProfile(raw);

export const PROFILE_PATH_USED = PROFILE_PATH;
export const PROFILE = raw;
export const BRAND = raw.brand ?? {};
export const TZ = raw.timezone || 'Asia/Shanghai';
export const MODULES_DEF = raw.modules;
export const PILLARS = raw.pillars ?? [];
export const DIMENSIONS = raw.dimensions;
export const PRIORITIES = raw.priorities;
export const STATUSES = raw.statuses ?? ['进行中', '已完成', '已调整', '已放弃'];
export const RULES = {
  mainlineLimit: raw.rules?.mainlineLimit ?? 3,
  requirePriority: raw.rules?.requirePriority ?? true,
  requireParentChain: raw.rules?.requireParentChain ?? false,
  subLineSplit: raw.rules?.subLineSplit ?? true
};

/** 维度父子链：dimensions 按「高周期 → 低周期」排列（三年 … 日），父级是前一项 */
export const PARENT_DIM = (() => {
  const m = {};
  for (let i = 1; i < DIMENSIONS.length; i++) m[DIMENSIONS[i]] = DIMENSIONS[i - 1];
  return m;
})();

/** 某个维度的全部上级维度（用于父目标合法性判断） */
export function ancestorDims(dim) {
  const idx = DIMENSIONS.indexOf(dim);
  return idx <= 0 ? [] : DIMENSIONS.slice(0, idx);
}
