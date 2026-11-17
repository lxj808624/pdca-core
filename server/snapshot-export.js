// 数据快照导出：SQLite → data/seed.ndjson（seed.js 的数据源，两者互为逆操作）
//
// 为什么需要：库是单一事实源，快照是可读、可 diff、可备份的整库副本。
// 快照与库不一致时，`npm run seed` 会用旧快照回滚库——所以改过库之后要重新导出。
//
// 用法：
//   npm run snapshot                                          # 导出到 data/seed.ndjson
//   node server/snapshot-export.js /tmp/out.ndjson            # 自定义输出路径
//   PDCA_DB=/path/to/live.db node server/snapshot-export.js   # 从指定库导出
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DATA_DIR, 'seed.ndjson');

// 列名沿用 seed.js 读取的键，保证 snapshot 与 seed 互逆
const toRow = (g) => ({
  record_id: g.id,
  目标名称: g.name,
  模块: g.module,
  时间维度: g.dimension,
  优先级: g.priority,
  状态: g.status,
  'Parent Goal': g.parent_id,
  '计划 (Plan)': g.plan,
  '验收标准 (KPI)': g.kpi,
  '执行 (Do)': g.do_note,
  '检查 (Check)': g.check_note,
  '行动 (Act)': g.act_note,
  预计耗时: g.est_effort,
  'Change Log': g.change_log,
  创建时间: g.created_at
});

const db = openDb();
const rows = db.prepare('SELECT * FROM goals ORDER BY created_at, id').all();

if (!rows.length) {
  console.error('库中没有任何目标，拒绝导出空快照（避免 seed 时把库清空）。');
  process.exit(1);
}

const body = rows.map((g) => JSON.stringify(toRow(g))).join('\n') + '\n';
fs.writeFileSync(OUT, body);

const byDim = {};
for (const r of rows) byDim[r.dimension ?? '未知'] = (byDim[r.dimension ?? '未知'] ?? 0) + 1;
console.log(`快照已导出：${OUT}`);
console.log(`共 ${rows.length} 条`);
for (const [k, v] of Object.entries(byDim)) console.log(`  ${k}: ${v}`);
