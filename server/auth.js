// 访问鉴权：访问口令 → 30 天会话 Cookie（HttpOnly）+ 脚本用 Bearer token
//
// 为什么是这个形态（2026-10-19 定）：
//   - 浏览器读接口靠「自动携带的 Cookie」；构建产物里不塞任何 secret；
//   - 写接口接受 Bearer token，也接受登录后的同源 Cookie（服务端校验 Origin 防 CSRF）；
//   - 会话值 = `v1.<签发时间戳>.<HMAC>`，无服务端状态，重启不掉线；
//     有效期由**服务端**校验（30 天），不依赖浏览器是否老实遵守 Max-Age；
//   - 活跃使用会滑动续期（超过 1 天再访问就换一张新票），所以天天用的人永不被迫重登；
//   - 改口令即全端失效（HMAC 密钥由口令派生），没有"改不了密码"的尴尬。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from './profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const COOKIE_NAME = 'pdca_session';
export const SESSION_DAYS = 30;
export const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SEC = SESSION_DAYS * 24 * 60 * 60;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000; // 已用满 1 天才续期，避免每个请求都 Set-Cookie
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 鉴权配置：环境变量优先，其次 server/config/api.json（该文件不入 git） */
export function loadAuth() {
  let cfg = {};
  const p = path.join(__dirname, 'config', 'api.json');
  if (fs.existsSync(p)) {
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { cfg = {}; }
  }
  return {
    token: process.env.PDCA_API_TOKEN || cfg.token || null,     // 写接口 + 脚本读
    passcode: process.env.PDCA_PASSCODE || cfg.passcode || null // 浏览器登录用
  };
}

function secretOf(passcode) {
  return crypto.createHmac('sha256', String(passcode)).update('pdca/session/v1').digest();
}

function sign(passcode, issued) {
  return crypto.createHmac('sha256', secretOf(passcode)).update(`v1.${issued}`).digest('base64url');
}

/** 签发会话值（v1.<毫秒时间戳>.<HMAC>） */
export function issueSession(passcode, now = Date.now()) {
  const issued = String(now);
  return `v1.${issued}.${sign(passcode, issued)}`;
}

/** 校验会话值：签名 + 有效期（服务端算，不信浏览器） */
export function verifySession(passcode, value, now = Date.now()) {
  const m = /^v1\.(\d{10,16})\.([A-Za-z0-9_-]{32,64})$/.exec(String(value ?? ''));
  if (!m) return { ok: false, reason: 'malformed' };
  const issued = Number(m[1]);
  const expect = sign(passcode, m[1]);
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };
  const age = now - issued;
  if (age < -CLOCK_SKEW_MS) return { ok: false, reason: 'clock-skew' };
  if (age > SESSION_TTL_MS) return { ok: false, reason: 'expired' };
  return { ok: true, age };
}

/** Cookie 头解析（只取需要的那个键，不引依赖） */
export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** 常量时间字符串比较（口令 / token 都走这里，避免按字节短路泄露长度信息） */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/**
 * 登录尝试限流（内存级即可：本系统单实例、单用户）
 * 同一 IP 在窗口期内失败 max 次后锁定剩余窗口，成功登录立即清零。
 */
export function createLoginLimiter({ max = 8, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map(); // ip -> { n, first }
  const sweep = (now) => {
    for (const [ip, v] of hits) if (now - v.first > windowMs) hits.delete(ip);
  };
  return {
    /** 返回剩余锁定秒数；0 表示可尝试 */
    retryAfter(ip, now = Date.now()) {
      sweep(now);
      const v = hits.get(ip);
      if (!v || v.n < max) return 0;
      return Math.ceil((windowMs - (now - v.first)) / 1000);
    },
    fail(ip, now = Date.now()) {
      sweep(now);
      const v = hits.get(ip) ?? { n: 0, first: now };
      v.n += 1;
      hits.set(ip, v);
    },
    reset(ip) { hits.delete(ip); }
  };
}

/** 续期判定：仅当会话已用满 1 天（避免每个请求都下发 Set-Cookie） */
export function shouldRenew(session) {
  return session?.ok && typeof session.age === 'number' && session.age > RENEW_AFTER_MS;
}

/** Set-Cookie 属性：反代后按 X-Forwarded-Proto 决定 Secure，本地 http 调试不下发 Secure（否则存不进） */
export function cookieHeader(req, value, { clear = false } = {}) {
  if (clear) return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0].trim();
  const secure = proto === 'https' ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`;
}

/** 登录页：单文件内联，不引用前端产物（未登录时静态资源一律拿不到也不需要） */
export function loginPage({ error = '' } = {}) {
  const msg = error ? `<p class="err">${error}</p>` : '';
  const title = BRAND.loginTitle || 'PDCA 目标管理';
  const subtitle = BRAND.loginSubtitle || '输入访问口令，登录后本设备 30 天免密';
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} · 解锁</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f9;color:#16181d;
       font:16px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  form{width:min(360px,88vw);padding:30px 26px;border:1px solid #e4e8ee;border-radius:14px;background:#fff;
       box-shadow:0 10px 30px rgba(16,24,40,.06)}
  h1{margin:0 0 6px;font-size:18px;font-weight:650;letter-spacing:.3px}
  p.sub{margin:0 0 20px;color:#697180;font-size:13px}
  input{width:100%;padding:11px 13px;border-radius:10px;border:1px solid #e4e8ee;background:#fff;color:#16181d;
        font-size:15px;outline:none}
  input:focus{border-color:#0f9d58;box-shadow:0 0 0 3px #e6f7ef}
  button{margin-top:12px;width:100%;padding:11px;border:0;border-radius:10px;background:#0f9d58;color:#fff;
         font-size:15px;font-weight:600;cursor:pointer}
  button:disabled{opacity:.6;cursor:default}
  p.err{margin:0 0 14px;color:#dc2626;font-size:13px}
  p.tip{margin:16px 0 0;color:#697180;font-size:12px}
</style></head>
<body>
<form id="f">
  <h1>${title}</h1>
  <p class="sub">${subtitle}</p>
  ${msg}
  <input id="p" type="password" name="passcode" placeholder="访问口令" autocomplete="current-password" autofocus required>
  <button id="b" type="submit">解锁</button>
  <p class="tip">连续输错会被临时限制尝试。</p>
</form>
<script>
  const f = document.getElementById('f'), p = document.getElementById('p'), b = document.getElementById('b');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    b.disabled = true; b.textContent = '验证中…';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: p.value })
      });
      if (res.ok) { location.replace('/'); return; }
      const data = await res.json().catch(() => ({}));
      b.disabled = false; b.textContent = '解锁';
      let old = f.querySelector('.err'); if (old) old.remove();
      const el = document.createElement('p'); el.className = 'err';
      el.textContent = res.status === 429 ? '尝试过于频繁，请稍后再试' : (data.error || '口令错误');
      f.insertBefore(el, p); p.value = ''; p.focus();
    } catch {
      b.disabled = false; b.textContent = '解锁';
    }
  });
</script>
</body></html>`;
}
