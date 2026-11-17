// 备份：数据库 + 世界观配置 → 带时间戳的目录
//
// 自托管版：一个 data/pdca.db，拷 .db + profile/ + 一份可读 ndjson
//
// 关键点：SQLite 跑在 WAL 模式，直接 cp .db 可能丢掉还没落盘的写入。
// 所以每个库都先 `PRAGMA wal_checkpoint(TRUNCATE)` 把 WAL 合并回主文件，再拷贝。
//
// 用法：
//   node server/backup.js                 # 备份到 ./backups/
//   node server/backup.js /mnt/nas/pdca   # 备份到指定目录
//   PDCA_DB=/path/live.db node server/backup.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, DB_PATH } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PROFILE_DIR = path.join(ROOT, 'profile');
const KEEP = 10; // 只保留最近 N 份，避免无限增长

const stamp = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();

const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'backups'));
fs.mkdirSync(outDir, { recursive: true });

/** 世界观配置整目录拷贝（换机器时 profile 和库要一起搬） */
function copyProfile(tag) {
  const profileOut = path.join(outDir, `profile-${tag}`);
  fs.mkdirSync(profileOut, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(PROFILE_DIR)) {
    if (!f.endsWith('.json')) continue;
    fs.copyFileSync(path.join(PROFILE_DIR, f), path.join(profileOut, f));
    n += 1;
  }
  return { dir: profileOut, files: n };
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`找不到数据库：${DB_PATH}`);
  console.error('库还不存在时不需要备份；服务首次启动会自动建库。');
  process.exit(1);
}

const dbOut = path.join(outDir, `pdca-${stamp}.db`);
const goalCount = (() => {
  const db = openDb();
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return db.prepare('SELECT COUNT(*) AS n FROM goals').get()?.n ?? 0;
  } finally {
    db.close();
  }
})();
fs.copyFileSync(DB_PATH, dbOut);

const prof = copyProfile(stamp);

// 再导一份可读的 ndjson（换机器/换库实现时也能救回来）
let ndjsonNote = '';
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [path.join(__dirname, 'snapshot-export.js'), path.join(outDir, `goals-${stamp}.ndjson`)], {
    stdio: 'ignore'
  });
  ndjsonNote = ` + goals-${stamp}.ndjson`;
} catch {
  ndjsonNote = '（ndjson 导出跳过：库为空或导出失败，主库备份不受影响）';
}

const dbs = fs
  .readdirSync(outDir)
  .filter((f) => /^pdca-\d{8}-\d{6}\.db$/.test(f))
  .sort();
for (const f of dbs.slice(0, Math.max(0, dbs.length - KEEP))) {
  fs.rmSync(path.join(outDir, f), { force: true });
}

console.log(`备份完成：${dbOut}${ndjsonNote}`);
console.log(`  目标 ${goalCount} 条，profile ${prof.files} 个文件 → ${prof.dir}`);
console.log(`  备份目录现有 ${Math.min(dbs.length, KEEP)} 份库备份（保留最近 ${KEEP} 份）`);
console.log('恢复用：bash deploy/restore.sh <备份.db>');
