// 把数据快照（data/seed.ndjson）导入 SQLite（幂等 upsert）
// 快照由 `npm run snapshot` 从库导出；库被改过后要先重导快照，否则本次 seed 会回滚那些改动。
//
// 快照里的字段名是「人可读」的（目标名称 / 模块 / 时间维度…），这里做归一化：
// 优先级取 P0/P1/P2 前缀、状态去掉 emoji 前缀、多值字段（数组）拼成字符串。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seedDemo } from './demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PDCA_SEED || path.join(__dirname, '..', 'data', 'seed.ndjson');

// ---- 归一化 ----
const first = (v) => (Array.isArray(v) ? v[0] : v);
const normPriority = (v) => {
  const raw = first(v);
  if (!raw) return null;
  const m = String(raw).trim().match(/^(P\d)/);
  return m ? m[1] : null;
};
const normStatus = (v) => {
  const raw = first(v);
  if (!raw) return null;
  return String(raw).replace(/^[^A-Za-z\u4e00-\u9fa5]+/, '').trim();
};
const normDimension = (v) => (first(v) ? String(first(v)).trim() : null);
const normModule = (v) => (first(v) ? String(first(v)).trim() : null);
const normText = (v) => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String).join(' | ') || null;
  const s = String(v).trim();
  return s || null;
};

// `--demo`：不读文件，按「今天」写一套当前周期的演示目标（与网页「一键导入演示数据」同一份）
const DEMO = process.argv.includes('--demo');

if (!DEMO && !fs.existsSync(SRC)) {
  const example = path.join(__dirname, '..', 'data', 'seed.example.ndjson');
  console.error(`找不到快照文件：${SRC}`);
  console.error('');
  console.error('三条路，任选一条：');
  console.error(`  1) 想先看效果：cp ${example} ${SRC} && npm run seed   （导入 5 条示例目标）`);
  console.error('  2) 从本库导出：npm run snapshot   （生成 data/export-snapshot.ndjson，再重命名/复制成 data/seed.ndjson）');
  console.error('  3) 自己的数据：写成一行一条 JSON，字段名见 data/seed.example.ndjson');
  console.error('');
  console.error('也可以不用 seed：空库启动后直接让 Agent 建目标，或手动 POST /api/goals。');
  console.error('');
  console.error('只想先看效果：npm run seed:demo   （按今天生成 7 条当前周期的演示目标，不读文件）');
  process.exit(1);
}

const db = openDb();

if (DEMO) {
  const r = seedDemo(db, { force: true });
  console.log(`演示数据 完成：共导入 ${r.inserted} 条目标`);
  for (const [k, v] of Object.entries(r.byDimension)) console.log(`  ${k}: ${v}`);
  process.exit(0);
}

const records = fs.readFileSync(SRC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const upsert = db.prepare(`
  INSERT INTO goals (id, name, module, dimension, priority, status, parent_id, plan, kpi,
                     do_note, check_note, act_note, est_effort, change_log, created_at, updated_at)
  VALUES (@id, @name, @module, @dimension, @priority, @status, @parent_id, @plan, @kpi,
          @do_note, @check_note, @act_note, @est_effort, @change_log, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, module=excluded.module, dimension=excluded.dimension,
    priority=excluded.priority, status=excluded.status, parent_id=excluded.parent_id,
    plan=excluded.plan, kpi=excluded.kpi, do_note=excluded.do_note,
    check_note=excluded.check_note, act_note=excluded.act_note,
    est_effort=excluded.est_effort, change_log=excluded.change_log,
    created_at=excluded.created_at
`);

const insertAll = (rows) => {
  db.exec('BEGIN');
  try {
    for (const r of rows) upsert.run(r);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

const now = new Date().toISOString();
const rows = records
  .map((r) => ({
    id: normText(r.record_id ?? r.id),
    name: normText(r['目标名称'] ?? r.name),
    module: normModule(r['模块'] ?? r.module),
    dimension: normDimension(r['时间维度'] ?? r.dimension),
    priority: normPriority(r['优先级'] ?? r.priority),
    status: normStatus(r['状态'] ?? r.status),
    parent_id: normText(r['Parent Goal'] ?? r.parent_id),
    plan: normText(r['计划 (Plan)'] ?? r.plan),
    kpi: normText(r['验收标准 (KPI)'] ?? r.kpi),
    do_note: normText(r['执行 (Do)'] ?? r.do_note),
    check_note: normText(r['检查 (Check)'] ?? r.check_note),
    act_note: normText(r['行动 (Act)'] ?? r.act_note),
    est_effort: normText(r['预计耗时'] ?? r.est_effort),
    change_log: normText(r['Change Log'] ?? r.change_log),
    created_at: normText(r['创建时间'] ?? r.created_at),
    updated_at: now
  }))
  .filter((r) => r.id && r.name);

insertAll(rows);

db.prepare(
  `INSERT INTO meta (key, value) VALUES ('seededAt', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
).run(now);
db.prepare(
  `INSERT INTO meta (key, value) VALUES ('source', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
).run(`seed.ndjson (${rows.length} rows)`);

const byDim = {};
for (const r of rows) byDim[r.dimension ?? '未知'] = (byDim[r.dimension ?? '未知'] ?? 0) + 1;
console.log(`Seed 完成：共导入 ${rows.length} 条目标`);
for (const [k, v] of Object.entries(byDim)) console.log(`  ${k}: ${v}`);
