// 语言判定：前端会带 Accept-Language，登录页也接受 ?lang=en；默认中文。
export function langOf(req) {
  const q = String(req?.query?.lang ?? '').toLowerCase();
  if (q === 'en' || q === 'zh') return q;
  const cookie = String(req?.headers?.cookie ?? '');
  const c = cookie.match(/(?:^|;\s*)pdca_lang=(en|zh)/);
  if (c) return c[1];
  const al = String(req?.headers?.['accept-language'] ?? '');
  return /^en/i.test(al) ? 'en' : 'zh';
}

export function tr(lang, zh, en) {
  return lang === 'en' ? en : zh;
}

// 内置标签的英文显示；自定义模块名原样返回
const LABELS = {
  '工作': 'Work', '学习': 'Learning', '生活': 'Life', '健康': 'Health',
  '家庭': 'Family', '兴趣': 'Hobbies', '财务': 'Finance', '其他': 'Other',
  '睡觉': 'Sleep', '工作日': 'Workday', '非工作日': 'Non-workday',
  '日计划': 'Day', '周计划': 'Week', '月计划': 'Month', '季度计划': 'Quarter',
  '年计划': 'Year', '三年计划': '3-year',
  '进行中': 'Active', '未完成': 'Missed', '已完成': 'Done',
  '已调整': 'Adjusted', '已放弃': 'Dropped', '待制定': 'To plan', '待复盘': 'To review'
};

export function labelOf(lang, v) {
  return lang === 'en' ? (LABELS[v] ?? v) : v;
}
