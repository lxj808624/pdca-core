// 前端写入通道：所有写入直接进后端，硬校验（validate.js）仍只在服务端，前端不复刻规则。
// 401 一律踢回登录页（口令会话过期时走这里）。
import { getLang } from './i18n.js';
async function request(url, { method = 'GET', body } = {}) {
  const res = await window.fetch(url, {
    method,
    headers: {
      'Accept-Language': getLang() === 'en' ? 'en' : 'zh-CN',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    window.location.replace('/login');
    throw new Error('session-expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `API ${res.status}`);
    err.status = res.status;
    err.errors = data.errors ?? [];
    err.warnings = data.warnings ?? [];
    err.payload = data;
    throw err;
  }
  return data;
}

const get = (url) => request(url);

export const fetchProfile = () => get('/api/profile');
export const fetchNow = (awake = false) => get(`/api/now${awake ? '?awake=true' : ''}`);
export const fetchGoals = () => get('/api/goals?limit=2000');
export const fetchCheck = () => get('/api/check');
export const fetchGoal = (id) => get(`/api/goals/${encodeURIComponent(id)}`);

export const createGoal = (goal) => request('/api/goals', { method: 'POST', body: goal });
export const updateGoal = (id, patch) => request(`/api/goals/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
export const deleteGoal = (id, { hard = false } = {}) =>
  request(`/api/goals/${encodeURIComponent(id)}${hard ? '?hard=true' : ''}`, { method: 'DELETE' });

export const importDemo = () => request('/api/demo', { method: 'POST', body: {} });

export const fetchMe = () => get('/api/me');
export const saveSettings = (timeBlocks) => request('/api/settings', { method: 'POST', body: { timeBlocks } });
// 首次上手：modules 为模块名数组，[] = 不分类（一张清单）
export const saveModules = (modules) => request('/api/setup', { method: 'POST', body: { modules } });
export const logout = () => request('/api/logout', { method: 'POST', body: {} });
