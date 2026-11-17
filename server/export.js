// 导出快照：SQLite → Markdown / JSON（人可读、可备份、可进 git）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { DIMENSIONS } from './profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const db = openDb();

const rows = db.prepare('SELECT * FROM goals ORDER BY created_at').all();

const jsonPath = path.join(DATA_DIR, 'export-snapshot.json');
fs.writeFileSync(jsonPath, JSON.stringify({ exportedAt: new Date().toISOString(), goals: rows }, null, 2));

const md = ['# PDCA 目标快照', '', `> 导出时间：${new Date().toISOString()}，共 ${rows.length} 条`, ''];
for (const dim of DIMENSIONS) {
  const group = rows.filter((r) => r.dimension === dim);
  if (!group.length) continue;
  md.push(`## ${dim}（${group.length}）`, '');
  for (const g of group) {
    const bits = [
      g.priority ? `[${g.priority}]` : null,
      g.status ? `[${g.status}]` : null,
      g.name,
      g.plan ? `｜Plan: ${g.plan.replace(/\n/g, ' ')}` : null,
      g.kpi ? `｜KPI: ${g.kpi.replace(/\n/g, ' ')}` : null
    ].filter(Boolean);
    md.push(`- ${bits.join(' ')}`);
  }
  md.push('');
}
fs.writeFileSync(path.join(DATA_DIR, 'export-snapshot.md'), md.join('\n'));

console.log(`已导出：${jsonPath}`);
console.log(`已导出：${path.join(DATA_DIR, 'export-snapshot.md')}`);
