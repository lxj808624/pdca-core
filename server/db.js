// 存储层：SQLite（node:sqlite 内置模块，零外部依赖）
//
// 核心版只有一张业务表：目标。其余（小事队列 / 习惯 / 时间线 / 借调 / 强制 / 复利）
// 已按 docs/SCOPE.md 移除——它们要么强依赖个人作息，要么强依赖个人调度器，不适合分发。
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.PDCA_DB || path.join(DATA_DIR, 'pdca.db');

// dbPath 可选：默认 data/pdca.db；测试或多实例时传别的路径
export function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      module TEXT,
      dimension TEXT,
      priority TEXT,
      status TEXT,
      parent_id TEXT,
      plan TEXT,
      kpi TEXT,
      do_note TEXT,
      check_note TEXT,
      act_note TEXT,
      est_effort TEXT,
      change_log TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_goals_dimension ON goals(dimension);
    CREATE INDEX IF NOT EXISTS idx_goals_module ON goals(module);
    CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_id);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
    -- 预留：世界观/迁移标记等键值对（如 schema_version）
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

// 用户级偏好（存在 meta 表里；一个库一份，多实例互不影响）
export function getMeta(db, key) {
  try {
    return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  } catch {
    return null;
  }
}
export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// 优先级排序权重（数字越小越靠前，未设优先级排最后）
export const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 };
export function priorityRank(p) {
  return PRIORITY_RANK[p] ?? 9;
}

// 状态展示顺序：未完成 → 进行中 → 已完成
export const STATUS_ORDER = { 未完成: 0, 进行中: 1, 已完成: 2 };

// 写入时统一的时间戳
export function nowIso() {
  return new Date().toISOString();
}
