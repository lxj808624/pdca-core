// 冒烟：不依赖任何测试框架，起一个临时库、把「登录 → 选模块 → 建目标 → 当下/复盘」跑一遍。
// 用法：bash scripts/smoke.sh（会自动起停服务；也可以 SMOKE_BASE=http://127.0.0.1:3000 node scripts/smoke.mjs）
const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:3311').replace(/\/$/, '');
const PASSCODE = process.env.SMOKE_PASSCODE || 'smoke-pass-123';
const TOKEN = process.env.SMOKE_TOKEN || 'smoke-token';
let cookie = '';
let failures = 0;

const log = (ok, name, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`);
  if (!ok) failures += 1;
};

async function req(method, path, body, { auth = true, origin = BASE, token = '' } = {}) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (cookie && auth) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON 页面 */ }
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, json, raw };
}

const today = (() => {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}`;
})();

log((await req('GET', '/api/health', undefined, { auth: false })).status === 200, '健康检查免鉴权');
log((await req('GET', '/api/now', undefined, { auth: false })).status === 401, '未登录读接口 401');
log((await req('GET', '/api/goals', undefined, { auth: false, token: TOKEN })).status === 200, 'Bearer 读接口 200');
log((await req('POST', '/api/login', { passcode: 'wrong' }, { auth: false })).status === 401, '错误口令 401');
log((await req('POST', '/api/login', { passcode: PASSCODE }, { auth: false })).status === 200, '口令登录 200');

const prof = await req('GET', '/api/profile');
log(prof.status === 200 && prof.json.modules.length > 0, '读世界观', `${prof.json.modules.length} 个模块`);
log(prof.json.moduleChoice === 'default', '初始模块来源 = profile 默认');

const single = await req('POST', '/api/setup', { modules: [] });
log(single.status === 200 && single.json.single === true, 'setup：选一张清单');
log((await req('GET', '/api/profile')).json.singleModule === true, '模拟：singleModule = true');

const badSetup = await req('POST', '/api/setup', { modules: '工作' });
log(badSetup.status === 400, 'setup 参数错误 400');
await req('POST', '/api/setup', { modules: [] });

log((await req('POST', '/api/goals', { name: `今日(${today})·用不存在的模块`, dimension: '日计划', module: '不存在的模块', priority: 'P0' })).status === 400, '模块越界 400');
const created = await req('POST', '/api/goals', { name: `今日(${today})·冒烟目标一`, dimension: '日计划', module: '目标', priority: 'P0' });
log(created.status === 201, '建第一个目标 201');
await req('POST', '/api/goals', { name: `今日(${today})·冒烟目标二`, dimension: '日计划', module: '目标', priority: 'P1' });
await req('POST', '/api/goals', { name: `今日(${today})·冒烟目标三`, dimension: '日计划', module: '目标', priority: 'P2' });
log((await req('POST', '/api/goals', { name: `今日(${today})·冒烟目标四`, dimension: '日计划', module: '目标', priority: 'P2' })).status === 409, '同组超 3 条主线 409');

const now = await req('GET', '/api/now');
const rec = now.json?.recommendation;
log(now.json?.goalCount === 3, '当下页看到 3 条目标');
log(Boolean(rec && !String(rec.task).startsWith('今日(')), '推荐文案去掉周期前缀', rec?.task ?? '');

const off = await req('POST', '/api/settings', { timeBlocks: false });
log(off.status === 200 && (await req('GET', '/api/now')).json.timeBlocks === false, '时间分块可关闭');
log((await req('POST', '/api/settings', { timeBlocks: 'yes' })).status === 400, '时间分块参数错误 400');

const demo1 = await req('POST', '/api/demo', undefined);
log(demo1.status === 201, '演示数据首次导入 201', `${demo1.json?.inserted ?? 0} 条`);
log((await req('POST', '/api/demo', undefined)).status === 409, '重复导入 409');

const check = await req('GET', '/api/check');
log(check.status === 200 && Array.isArray(check.json.deviations), '复盘聚合可用');

log((await req('POST', '/api/logout', {})).status === 200, '登出 200');
log((await req('GET', '/api/now', undefined, { auth: false })).status === 401, '登出后读接口 401');
log((await req('GET', '/api/now', undefined, { auth: false, token: TOKEN })).status === 200, '登出后 Bearer 仍可读');
const tokenWrite = await req('POST', '/api/goals', { name: '11月：冒烟 Bearer 写入', dimension: '月计划', module: '目标', priority: 'P0' }, { auth: false, token: TOKEN });
log(tokenWrite.status === 201, 'Bearer 建目标 201', tokenWrite.json?.error ?? '');

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
