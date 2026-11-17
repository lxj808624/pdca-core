// PDCA Core API 服务：Fastify + node:sqlite，生产环境同时托管前端构建产物
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { openDb, priorityRank, setMeta } from './db.js';
import { seedDemo } from './demo.js';
import { buildNowPayload, timeBlocksSetting, TZ, zonedParts, weekRange, parseDayGoal, parseMonthGoal, isToday, isCurrentWeek, isRealDate, hostModulesAt } from './now.js';
import { SLOT_MODULES } from './modules.js';
import { PROFILE, BRAND, DIMENSIONS, PRIORITIES, STATUSES, RULES } from './profile.js';
import { userModules, setUserModules, SINGLE_MODULE } from './usermodules.js';
import { buildCheckPayload } from './check.js';
import { validateCreate, validateUpdate, appendChangeLog, splitParentIds } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

const app = Fastify({ logger: { level: 'warn' } });
await app.register(cors, { origin: true });

// 自托管单租户：一个进程一个库（`PDCA_DB`，默认 data/pdca.db）
const singleDb = openDb();

// ---------- 访问鉴权（读 Cookie 会话 / 写 Bearer token） ----------
// 2026-10-19 起读接口不再匿名开放（安全扫描项：可匿名读取个人数据）。
//   · 浏览器：访问口令 POST /api/login → 30 天 HttpOnly 会话 Cookie，页面与读接口都靠它；
//   · 脚本 / 定时任务：读也走 Authorization: Bearer <token>（token 见 server/config/api.json）；
//   · 写接口**只认 Bearer token**，Cookie 不授权写入（天然免 CSRF）；
//   · 未配置任何凭据（本地开发）→ 全放行，保持原有开发体验。
import {
  loadAuth, issueSession, verifySession, readCookie, safeEqual, createLoginLimiter,
  shouldRenew, cookieHeader, loginPage, COOKIE_NAME, SESSION_DAYS
} from './auth.js';

const { token: API_TOKEN, passcode: PASSCODE } = loadAuth();
const AUTH_ON = Boolean(PASSCODE);
const TOKEN_ON = Boolean(API_TOKEN);
const loginLimiter = createLoginLimiter();

// 无需鉴权的路径：健康检查（部署/监控用，不含数据）、登录页与登录/登出接口、静态资源（不含数据）
const OPEN_EXACT = new Set(['/api/health', '/api/login', '/api/logout', '/login', '/favicon.ico']);
const OPEN_PREFIX = ['/assets/', '/favicon', '/apple-touch-icon', '/safari-pinned-tab'];

function bearerOf(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-api-token'] || '');
}

/** 读请求的会话判定：Cookie 会话优先，其次 Bearer token（脚本用） */
function readSession(req) {
  const raw = readCookie(req.headers.cookie, COOKIE_NAME);
  if (raw && AUTH_ON) {
    const s = verifySession(PASSCODE, raw);
    if (s.ok) return s;
  }
  const token = bearerOf(req);
  if (TOKEN_ON && token && safeEqual(token, API_TOKEN)) return { ok: true, via: 'token' };
  return { ok: false };
}

app.addHook('onRequest', async (req, reply) => {
  if (!AUTH_ON && !TOKEN_ON) return;               // 本地开发：未配置凭据，放行
  const url = String(req.url).split('?')[0];
  if (OPEN_EXACT.has(url) || OPEN_PREFIX.some((p) => url.startsWith(p))) return;

  const isApi = url.startsWith('/api/');
  const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';

  // ① 读：需要会话（Cookie 或 Bearer token）
  if (isRead && AUTH_ON) {
    const s = readSession(req);
    if (!s.ok) {
      if (isApi) {
        return reply.code(401).send({
          error: 'unauthorized',
          hint: '浏览器请先 POST /api/login 换取会话 Cookie；脚本请带 Authorization: Bearer <token>'
        });
      }
      return reply.redirect('/login');
    }
    // 滑动续期：已用满 1 天的会话再访问时换新票，天天用就永不掉线
    if (shouldRenew(s)) reply.header('set-cookie', cookieHeader(req, issueSession(PASSCODE)));
    return;
  }

  // ② 写：两条通道
  //   · 脚本 / Agent：Authorization: Bearer <token>
  //   · 浏览器页面：同源 Cookie 会话（校验 Origin，跨站发不出这个头，等同 CSRF 防护）
  if (!isRead && isApi) {
    const token = bearerOf(req);
    if (TOKEN_ON && token && safeEqual(token, API_TOKEN)) return;

    const s = AUTH_ON ? readSession(req) : { ok: false };
    if (!s.ok || s.via === 'token') {
      return reply.code(401).send({
        error: 'unauthorized',
        hint: '页面写入需要先登录（Cookie）；脚本写入请带 Authorization: Bearer <token>'
      });
    }
    let same = false;
    try {
      same = req.headers.origin ? new URL(req.headers.origin).host === req.headers.host : req.headers['x-pdca-client'] === 'web';
    } catch { same = false; }
    if (!same) return reply.code(403).send({ error: 'forbidden', hint: '写接口只接受页面内同源请求' });
  }
});

// 单租户模式：所有请求共用同一个库句柄
app.addHook('preHandler', async (req) => { if (!req.db) req.db = singleDb; });

// ---------- 登录 / 登出 ----------

app.post('/api/login', async (req, reply) => {
  if (!AUTH_ON) return reply.code(503).send({ error: '未配置访问口令（PDCA_PASSCODE 或 server/config/api.json 的 passcode）' });
  const ip = req.ip ?? 'unknown';
  const wait = loginLimiter.retryAfter(ip);
  if (wait > 0) {
    reply.header('Retry-After', String(wait));
    return reply.code(429).send({ error: '尝试过于频繁，请稍后再试', retryAfter: wait });
  }
  const given = String((req.body ?? {}).passcode ?? '');
  if (!given || !safeEqual(given, PASSCODE)) {
    loginLimiter.fail(ip);
    return reply.code(401).send({ error: '口令错误' });
  }
  loginLimiter.reset(ip);
  reply.header('set-cookie', cookieHeader(req, issueSession(PASSCODE)));
  return { ok: true, expiresInDays: SESSION_DAYS };
});

app.post('/api/logout', async (req, reply) => {
  reply.header('set-cookie', cookieHeader(req, '', { clear: true }));
  return { ok: true };
});

// 登录页：已登录直接回首页
app.get('/login', async (req, reply) => {
  if (AUTH_ON && readSession(req).ok) return reply.redirect('/');
  reply.type('text/html; charset=utf-8');
  reply.header('Cache-Control', 'no-store');
  return loginPage();
});



// ---------- API ----------

app.get('/api/health', async () => ({ ok: true, tz: TZ }));

// 世界观配置：前端据此渲染模块/支柱/维度，不在构建产物里写死任何具体体系
app.get('/api/profile', async (req) => {
  const tb = timeBlocksSetting(req.db);
  const um = userModules(req.db);
  return {
  timeBlocks: tb.on,
  timeBlockChoice: tb.choice,
  moduleChoice: um.custom ? (um.single ? 'single' : 'custom') : 'default',
  singleModule: um.single,
  brand: BRAND,
  modules: um.modules,
  pillars: PROFILE.pillars ?? [],
  dimensions: DIMENSIONS,
  priorities: PRIORITIES,
  statuses: STATUSES,
  rules: RULES,
  timezone: TZ
  };
});

// 用户偏好：时间分块开/关（存 meta.time_blocks，跟库走）
app.get('/api/settings', async (req) => {
  const tb = timeBlocksSetting(req.db);
  return { timeBlocks: tb.on, timeBlockChoice: tb.choice };
});

// 首次上手：用户自己决定要不要分模块。modules: [] = 单清单（不划分）
app.post('/api/setup', async (req, reply) => {
  const body = req.body ?? {};
  const raw = body.modules;
  if (!Array.isArray(raw)) {
    return reply.code(400).send({ error: 'modules 必须是数组（[] 表示不划分模块）' });
  }
  const names = raw
    .map((m) => (typeof m === 'string' ? m : m?.name))
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (names.some((n) => n.length > 12)) {
    return reply.code(400).send({ error: '模块名最多 12 个字' });
  }
  setUserModules(req.db, names);
  if (typeof body.timeBlocks === 'boolean') setMeta(req.db, 'time_blocks', body.timeBlocks ? 'on' : 'off');
  const um = userModules(req.db);
  return { ok: true, modules: um.modules, single: um.single };
});

app.post('/api/settings', async (req, reply) => {
  const v = req.body?.timeBlocks;
  if (typeof v !== 'boolean') {
    return reply.code(400).send({ error: 'timeBlocks 必须是 true / false' });
  }
  setMeta(req.db, 'time_blocks', v ? 'on' : 'off');
  return { ok: true, timeBlocks: v };
});

app.get('/api/now', async (req) => buildNowPayload(req.db, new Date(), { awake: req.query.awake === 'true' }));

// Check 页聚合：完成率 + 偏差检测 + 复盘时间线
app.get('/api/check', async (req) => buildCheckPayload(req.db));

// 下级目标查找：parent_id 可能是分号拼接的多上级，逐条拆分匹配（表小，全量拉取后在 JS 侧过滤）
function childrenOf(db, id, fields = 'id, name, dimension, priority, status') {
  return db
    .prepare(`SELECT ${fields}, parent_id FROM goals`)
    .all()
    .filter((g) => splitParentIds(g.parent_id).includes(id))
    .map(({ parent_id, ...rest }) => rest);
}

// 目标列表：?dimension=日计划&module=工作&status=进行中&q=关键词&limit=100
app.get('/api/goals', async (req) => {
  const { dimension, module, status, q, limit } = req.query;
  const clauses = [];
  const params = {};
  if (dimension) { clauses.push('dimension = @dimension'); params.dimension = dimension; }
  // module 用 LIKE 匹配：历史数据可能存在「工作（深度）」这类带括号后缀的写法，
  // 精确匹配会整组漏掉——如 module=工作 查不到该组的历史目标
  if (module) { clauses.push('(module LIKE @moduleLike OR name LIKE @moduleLike)'); params.moduleLike = `%${module}%`; }
  if (status) { clauses.push('status = @status'); params.status = status; }
  if (q) { clauses.push('name LIKE @q'); params.q = `%${q}%`; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit ?? '200', 10) || 200, 1000);
  const rows = req.db.prepare(
    `SELECT id, name, module, dimension, priority, status, parent_id, plan, kpi, created_at
     FROM goals ${where} ORDER BY created_at DESC LIMIT ${lim}`
  ).all(params);
  rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  return { count: rows.length, goals: rows };
});

// 业务线过滤：q 是子业务线关键词（带 subLines 的模块），不是纯名称过滤。
// 名称命中 q 的目标作种子，沿 parent_id 向上纳入全部祖先（支持分号多上级）。
// 顶层（三年/年）目标名称通常不含子模块关键词（如「成为顶尖开发者」属软件开发线、
// 「顶尖量化私募 QR 水平」属 Trading 线），只做 name LIKE 会把这些顶层目标整组静默误杀。
function scopeByLine(rows, q) {
  const kw = String(q);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kept = new Set();
  const stack = rows.filter((r) => (r.name ?? '').includes(kw)).map((r) => r.id);
  while (stack.length) {
    const id = stack.pop();
    if (kept.has(id)) continue;
    kept.add(id);
    for (const pid of splitParentIds(byId.get(id)?.parent_id)) {
      if (byId.has(pid) && !kept.has(pid)) stack.push(pid);
    }
  }
  return rows.filter((r) => kept.has(r.id));
}

// 年/季度周期识别：名称带前缀时（<YYYY>年 / Q<N>）必须等于当前周期，用于排除往年、往季目标；
// 不带前缀的不参与排除——它不可能是"别的周期"的目标，静默丢弃会漏掉本周期目标
// （如「成为独立开发者」是本年目标却无年份前缀）。月/周/日识别仍严格要求前缀：
// 月/周/日目标天然按周期切分，无前缀即无法归属，应落到 missing 提醒补建。
const YEAR_RE = /^(\d{4})年/;
const QUARTER_RE = /^Q(\d)/;
function inYear(name, year) {
  const m = String(name ?? '').match(YEAR_RE);
  return !m || Number(m[1]) === year;
}
function inQuarter(name, quarter) {
  const m = String(name ?? '').match(QUARTER_RE);
  return !m || `Q${m[1]}` === quarter;
}

// 目标链聚合投影（Plan/Check 数据准备 · 单次请求替代全量拉取 + 客户端分组）
// 入参：module 必填；q 可选（子业务线关键词，分别请求各子线）
// 服务端按周期分组（复用 now.js 周期解析，日期由服务端算），只返回消息所需精简字段
app.get('/api/goals/chain', async (req, reply) => {
  const { module, q } = req.query;
  if (!module) return reply.code(400).send({ error: 'module 必填', hint: '如 ?module=工作；带子线的模块加 &q=子线名' });
  const p = zonedParts();
  // 候选集只按模块收窄；q 的裁剪交给 scopeByLine（需父链信息，不能在 SQL 里做）
  const candidates = req.db.prepare(
    `SELECT id, name, module, dimension, priority, status, plan, check_note, parent_id, created_at
     FROM goals WHERE (module LIKE @moduleLike OR name LIKE @moduleLike) ORDER BY created_at DESC LIMIT 2000`
  ).all({ moduleLike: `%${module}%` });
  const rows = q ? scopeByLine(candidates, q) : candidates;

  // 提前量（⚡ 提前量：取自 X 目标「Y」｜交付 Z｜放弃 W）单独投影。
  // 不能靠 brief 里的 plan 摘要——它截断 90 字，而约定写在 plan 末行，正好会被切掉。
  // 2026-10-19 加：让 Plan/Check 的定时消息能直接显示本期提前量，不必额外拉全量 goals。
  const pullForwardOf = (g) => {
    const m = String(g.plan ?? '').match(/⚡\s*提前量\s*[：:]\s*([^\n]+)/);
    return m ? m[1].trim() : null;
  };
  const brief = (g) => ({
    priority: g.priority ?? null,
    name: g.name,
    status: g.status ?? null,
    plan: (g.plan ?? '').slice(0, 90) || null,
    pullForward: pullForwardOf(g)
  });
  const y = new Date(Date.UTC(p.year, p.month - 1, p.day - 1)); // 昨天
  const yd = { month: y.getUTCMonth() + 1, day: y.getUTCDate() };
  const quarter = `Q${Math.ceil(p.month / 3)}`;
  const isDay = (g, m, d) => { const pd = parseDayGoal(g.name); return !!pd && pd.month === m && pd.day === d; };

  const groups = {
    三年: rows.filter((g) => g.dimension === '三年计划' && g.status === '进行中').map(brief),
    年: rows.filter((g) => g.dimension === '年计划' && g.status === '进行中' && inYear(g.name, p.year)).map(brief),
    季度: rows.filter((g) => g.dimension === '季度计划' && g.status === '进行中' && inQuarter(g.name, quarter)).map(brief),
    月: rows.filter((g) => g.dimension === '月计划' && g.status === '进行中' && (parseMonthGoal(g.name)?.month === p.month)).map(brief),
    周: rows.filter((g) => g.dimension === '周计划' && g.status === '进行中' && isCurrentWeek(g, p)).map(brief),
    今日: rows.filter((g) => g.dimension === '日计划' && isToday(g, p)).map(brief),
    昨日: rows.filter((g) => g.dimension === '日计划' && isDay(g, yd.month, yd.day))
      .map((g) => ({ name: g.name, priority: g.priority ?? null, status: g.status ?? null, checkNote: (g.check_note ?? '').slice(0, 200) || null }))
  };
  const dayGoals = rows.filter((g) => g.dimension === '日计划');
  const latest = dayGoals[0] ?? null; // created_at DESC，首条即最近
  const missing = ['三年计划', '年计划', '季度计划', '月计划', '周计划', '日计划']
    .filter((dim, i) => groups[['三年', '年', '季度', '月', '周', '今日'][i]].length === 0);

  return {
    module,
    today: p.dateLabel,
    weekLabel: weekRange(p),
    groups,
    missing,
    latestDayGoal: latest ? { name: latest.name, status: latest.status ?? null, createdAt: latest.created_at ?? null } : null
  };
});

// 目标详情 + 完整目标链（向上追溯 parent）
app.get('/api/goals/:id', async (req, reply) => {
  const row = req.db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!row) return reply.code(404).send({ error: 'not found' });
  const chain = [];
  let cur = row;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift({ id: cur.id, name: cur.name, dimension: cur.dimension, priority: cur.priority, status: cur.status, plan: cur.plan, kpi: cur.kpi });
    cur = cur.parent_id ? req.db.prepare('SELECT * FROM goals WHERE id = ?').get(splitParentIds(cur.parent_id)[0]) : null;
  }
  const children = childrenOf(req.db, row.id);
  return { goal: row, chain, children };
});

// 本周概览
app.get('/api/week', async (req) => {
  const payload = buildNowPayload(req.db);
  return {
    weekLabel: payload.today.weekLabel,
    todayStats: payload.todayStats,
    weekGoals: payload.weekGoals
  };
});

// 简单统计（按时间维度 × 状态）
app.get('/api/stats', async (req) => {
  const rows = req.db.prepare('SELECT dimension, status, COUNT(*) AS n FROM goals GROUP BY dimension, status').all();
  const out = {};
  for (const r of rows) {
    out[r.dimension ?? '未知'] = out[r.dimension ?? '未知'] ?? { total: 0 };
    out[r.dimension ?? '未知'].total += r.n;
    out[r.dimension ?? '未知'][r.status ?? '未知'] = r.n;
  }
  return out;
});

// ---------- 写接口（所有写入必须过硬校验：规则在 validate.js，Agent 不可绕过） ----------

const CREATE_FIELDS = ['name', 'module', 'dimension', 'priority', 'status', 'parent_id', 'plan', 'kpi', 'do_note', 'check_note', 'act_note', 'est_effort'];
const PATCH_FIELDS = ['name', 'module', 'dimension', 'priority', 'status', 'parent_id', 'plan', 'kpi', 'do_note', 'check_note', 'act_note', 'est_effort'];

function newId() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// 一键导入演示数据（toC 首启引导）：按「今天」生成 7 条当前周期目标
// 已导过不再覆盖（用户可能改过状态），显式 ?force=true 才重写
app.post('/api/demo', async (req, reply) => {
  const force = req.query.force === 'true';
  const modules = userModules(req.db).modules.map((m) => m.name);
  const r = seedDemo(req.db, { force, modules });
  if (!r.ok) {
    return reply.code(409).send({
      error: '已经导入过演示数据',
      hint: '想重新生成请带 ?force=true（会覆盖 demo-* 这 7 条，你新建的目标不受影响）',
      existing: r.existing
    });
  }
  return reply.code(201).send(r);
});

// 创建目标：违规直接拦截（400/409），合法写入自动落库
app.post('/api/goals', async (req, reply) => {
  const body = req.body ?? {};
  const g = {};
  for (const k of CREATE_FIELDS) if (body[k] !== undefined) g[k] = body[k];
  if (g.status === undefined) g.status = '进行中';

  const v = validateCreate(req.db, g, userModules(req.db).modules);
  if (!v.ok) {
    return reply.code(v.status).send({ error: '写入被规则拦截', errors: v.errors, warnings: v.warnings });
  }

  const now = new Date().toISOString();
  const row = {
    id: newId(),
    name: g.name, module: g.module, dimension: g.dimension, priority: g.priority,
    status: g.status, parent_id: g.parent_id ?? null, plan: g.plan ?? null, kpi: g.kpi ?? null,
    do_note: g.do_note ?? null, check_note: g.check_note ?? null, act_note: g.act_note ?? null,
    est_effort: g.est_effort ?? null, change_log: `[${now.slice(0, 10)}] 创建目标`,
    created_at: now, updated_at: now
  };
  req.db.prepare(`
    INSERT INTO goals (id, name, module, dimension, priority, status, parent_id, plan, kpi,
                       do_note, check_note, act_note, est_effort, change_log, created_at, updated_at)
    VALUES (@id, @name, @module, @dimension, @priority, @status, @parent_id, @plan, @kpi,
            @do_note, @check_note, @act_note, @est_effort, @change_log, @created_at, @updated_at)
  `).run(row);
  return reply.code(201).send({ goal: row, warnings: v.warnings });
});

// 更新目标：PATCH 语义，只改传入字段，自动追加 Change Log
app.patch('/api/goals/:id', async (req, reply) => {
  const existing = req.db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!existing) return reply.code(404).send({ error: 'not found' });

  const body = req.body ?? {};
  const patch = {};
  for (const k of PATCH_FIELDS) if (body[k] !== undefined) patch[k] = body[k];
  if (!Object.keys(patch).length && typeof body.note !== 'string') {
    return reply.code(400).send({ error: '没有可更新的字段' });
  }

  const v = validateUpdate(req.db, existing, patch, userModules(req.db).modules);
  if (!v.ok) {
    return reply.code(v.status).send({ error: '更新被规则拦截', errors: v.errors, warnings: v.warnings });
  }

  const note = typeof body.note === 'string' ? body.note : null;
  const changeLog = appendChangeLog(existing.change_log, v.changes, note);
  if (patch.urgent !== undefined) patch.urgent = patch.urgent ? 1 : 0;
  if (patch.module === '') patch.module = null;
  const now = new Date().toISOString();
  const assignments = [...Object.keys(patch).map((k) => `${k} = @${k}`), 'change_log = @change_log', 'updated_at = @updated_at'];
  req.db.prepare(`UPDATE goals SET ${assignments.join(', ')} WHERE id = @id`)
    .run({ ...patch, change_log: changeLog, updated_at: now, id: existing.id });

  const row = req.db.prepare('SELECT * FROM goals WHERE id = ?').get(existing.id);
  return { goal: row, changes: v.changes, warnings: v.warnings };
});

// 删除目标：默认软删（状态→已放弃，保留历史）；?hard=true 且无下级时才物理删除
app.delete('/api/goals/:id', async (req, reply) => {
  const existing = req.db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  if (!existing) return reply.code(404).send({ error: 'not found' });

  const children = childrenOf(req.db, existing.id, 'id, name');
  if (children.length) {
    return reply.code(409).send({
      error: '存在下级目标，禁止删除（目标链不允许断裂）：请先处理下级目标',
      children
    });
  }

  if (req.query.hard === 'true') {
    req.db.prepare('DELETE FROM goals WHERE id = ?').run(existing.id);
    return { deleted: existing.id, mode: 'hard' };
  }

  const now = new Date().toISOString();
  const changeLog = appendChangeLog(existing.change_log, { status: `${existing.status ?? '无'} → 已放弃` }, '删除（软删，保留历史）');
  req.db.prepare("UPDATE goals SET status = '已放弃', change_log = ?, updated_at = ? WHERE id = ?")
    .run(changeLog, now, existing.id);
  const row = req.db.prepare('SELECT * FROM goals WHERE id = ?').get(existing.id);
  return { goal: row, mode: 'soft' };
});

// 飞书群推送：POST /api/push { text }
// ---------- 前端静态托管 ----------

if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  await app.register(fastifyStatic, { root: CLIENT_DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({
    hint: '前端未构建：先运行 npm run build，再重启服务；API 见 /api/now /api/goals /api/week /api/stats'
  }));
}

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1'; // 默认只听本地，由 Nginx 反代对外（云主机安全惯例）
app.listen({ port, host }).then(() => {
  console.log(`pdca-core listening on http://${host}:${port} (TZ=${TZ})`);
});
