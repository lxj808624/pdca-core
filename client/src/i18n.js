// 轻量 i18n：中文为源文案，英文按中文 key 查表。
// 语言优先级：localStorage → cookie → 浏览器语言；中文环境默认中文，其余默认英文。
import { useEffect, useState } from 'react';

const EN = {
  // 导航 / 通用
  '当下': 'Now',
  '目标链': 'Goals',
  '复盘': 'Review',
  '退出': 'Sign out',
  '加载失败：': 'Failed to load: ',
  '加载中…': 'Loading…',
  '配置加载失败：': 'Failed to load profile: ',
  '关闭': 'Close',
  '删除': 'Delete',
  '编辑': 'Edit',
  '取消': 'Cancel',
  '保存': 'Save',
  '创建': 'Create',
  '保存中…': 'Saving…',
  '返回': 'Back',
  '设置': 'Settings',
  '第一步': 'Step 1',
  '其他维度': 'Other periods',
  '目标详情': 'Goal details',
  '目标链（详情）': 'Goal chain',
  '调整': 'Change',
  '变更记录': 'Change log',
  '下级目标（{n}）': 'Sub-goals ({n})',
  '表单与 Agent 共用同一套后端校验；表单被拦时会写清是哪条规则。':
    'Forms and agents share the same server-side validation. When a form is blocked, the rule is shown.',
  '目标链 + 当下引擎': 'Goal chain + Now engine',

  // 星期 / 日型 / 时段
  '周日': 'Sun', '周一': 'Mon', '周二': 'Tue', '周三': 'Wed', '周四': 'Thu', '周五': 'Fri', '周六': 'Sat',
  '工作日': 'Workday',
  '非工作日': 'Non-workday',
  '休息日': 'Rest day',
  '睡觉时间': 'Sleep time',
  '明早再继续。': 'Pick it up tomorrow morning.',
  '睡觉': 'Sleep',
  '自主安排': 'Free time',
  '回顾': 'Review',
  '审视': 'Review',
  'Plan': 'Plan', 'Do': 'Do', 'Check': 'Check', 'Act': 'Act',

  // 目标状态 / 维度 / 默认模块 / 优先级
  '进行中': 'Active',
  '未完成': 'Missed',
  '已完成': 'Done',
  '已调整': 'Adjusted',
  '已放弃': 'Dropped',
  '待制定': 'To plan',
  '待复盘': 'To review',
  '三年计划': '3-year',
  '年计划': 'Year',
  '季度计划': 'Quarter',
  '月计划': 'Month',
  '周计划': 'Week',
  '日计划': 'Day',
  '工作': 'Work',
  '学习': 'Learning',
  '生活': 'Life',
  '健康': 'Health',
  '家庭': 'Family',
  '兴趣': 'Hobbies',
  '财务': 'Finance',
  '副业': 'Side project',
  '其他': 'Other',

  // 当下页
  '今天的事都做完了': 'Everything for today is done',
  '今天还没有安排': 'Nothing scheduled for today',
  '今天 {n} 件，已完成 {m} 件': '{n} today · {m} done',
  '先做这件': 'Start here',
  '现在该做': 'Do this now',
  '现在，安心睡眠': 'Sleep now',
  '当前事项已处理完': 'Nothing left on deck',
  '可以休息，或到 Plan 查看后续安排。': 'Take a break, or check Goals for what is next.',
  '匹配当前时段，推进已制定的目标': 'Matches the current time block',
  '不属于当前时段模块，今日仍要完成（收进折叠区，仅备查）':
    'Outside the current time block, but still due today (kept in the collapsed section)',
  '今天还要做': 'Still to do today',
  '{n} 件未完成': '{n} unfinished',
  '今天没有要推进的目标。到「目标链」加一条就行。':
    'Nothing to push today. Add a goal in Goals.',
  '今日其他时段/模块的目标（{n}）': 'Goals outside this time block ({n})',
  '今天的时段安排（{n}）': 'Today’s time blocks ({n})',

  // 首启
  '没保存成功，再试一次': 'Could not save. Try again.',
  '第一次使用 · 两步就好': 'First run · two steps',
  '你的目标要分类吗？': 'Do you want to group your goals?',
  '分类之后，目标会分到「工作 / 学习 / 健康」这样的格子里。不分类就是一张清单，更省事。':
    'Grouped goals get buckets like Work / Learning / Health. One list is simpler.',
  '就一张清单': 'One list',
  '所有目标放在一起，按优先级排': 'All goals together, sorted by priority',
  '分几个类别': 'Use categories',
  '每类单独一条线，适合事情多、方向杂': 'One line per category, useful when work spans several areas',
  '选几个类别': 'Pick a few categories',
  '挑现成的，或者自己起名字，最多 8 个。之后想改跟 Agent 说一声。':
    'Pick from the list or name your own. Up to 8; ask your agent to change them later.',
  '自己起一个，例如「副业」': 'Name one, e.g. “Side project”',
  '加上': 'Add',
  '已选：{names}': 'Selected: {names}',
  '就这些': 'That’s it',
  '建第一个目标': 'Create your first goal',
  '写一句你要做成的事，选个时间范围就行。': 'Describe one outcome and pick a time horizon.',
  '写一句你要做成的事，选个类别和时间范围。': 'Describe one outcome, then pick a category and time horizon.',
  '建完之后，它会出现在「今天」的清单里。': 'It will show up in today’s list.',

  // 目标表单
  '编辑目标': 'Edit goal',
  '新建目标': 'New goal',
  '没写进去，{n} 条规则不通过：': 'Not saved. {n} rule(s) failed:',
  '已保存，但建议补一下：': 'Saved, with suggestions:',
  '要做成什么': 'What do you want to achieve?',
  '插入「{prefix}」': 'Insert “{prefix}”',
  '例：{prefix}把报价单发给客户并确认': 'e.g. {prefix}Send the quote and get confirmation',
  '例：三年内把团队做到 10 人': 'e.g. Grow the team to 10 people in three years',
  '时间范围': 'Time horizon',
  '优先级': 'Priority',
  '类别': 'Category',
  '子类': 'Sub-category',
  '请选择': 'Select',
  '状态': 'Status',
  '更多（可选）': 'More (optional)',
  '挂到哪个上级目标': 'Parent goal',
  '不挂（上面没有{parent}）': 'None (no {parent} above)',
  '已经是最上层': 'Already at the top',
  '怎么算做成了': 'Definition of done',
  '例：客户确认收到，款到账': 'e.g. Client confirms receipt and payment clears',
  '打算怎么做': 'Plan',
  '例：先切 2 个高价客户，每周复盘一次': 'e.g. Start with two high-value clients, review weekly',

  // 目标链
  '目标链全景': 'All goals',
  '+ 新建目标': '+ New goal',
  '还没有目标。建第一条，它才有东西可看。': 'No goals yet. Create the first one.',
  '共 {n} 条目标，当前周期 {m} 条。': '{n} goals total · {m} in the current period.',
  '今天 {date}': 'Today {date}',
  '本周 {week}': 'This week {week}',
  '先建一个目标': 'Create your first goal',
  '写一句你要做成的事，选个时间范围；建完这里就会有链条和进度。':
    'Describe one outcome and pick a time horizon. The chain and progress start here.',
  '全部时间': 'All time',
  '当前周期': 'Current',
  '历史周期': 'History',
  '全部模块': 'All categories',
  '全部状态': 'All statuses',
  '搜索目标 / 计划 / KPI…': 'Search goals / plans / KPIs…',
  '搜索目标': 'Search goals',
  '{n} 条 · {m} 已完成': '{n} goals · {m} done',
  '没有匹配的目标。点上方「+ 新建目标」建第一条，或调整筛选条件。':
    'No matching goals. Use “+ New goal” above, or change the filters.',
  '按时间段安排：{state}': 'Time blocks: {state}',
  '开启': 'on',
  '关闭': 'off',
  '改成{next}': 'Switch to {next}',
  '不分块': 'no time blocks',
  '按时间段': 'time blocks',

  // 复盘
  '完成情况 · {date}': 'Progress · {date}',
  '今日目标': 'Today',
  '本周 · {week}': 'This week · {week}',
  '偏差提示 · {n}': 'Deviations · {n}',
  '无偏差': 'No deviations',
  '目标齐全、主线数量合规、子业务线分离正常':
    'Goal chain intact · active goals within limit · sub-lines separated',
  '模块完成率（今日）': 'Completion by category (today)',
  '周更 · 按周验收': 'weekly · reviewed by week',
  '不设目标': 'no goals',
  '今日无排班': 'not scheduled today',
  '未建': 'not created',
  '复盘时间线': 'Review timeline',
  '还没有复盘记录。完成 Check 流程后，check/act 笔记会出现在这里。':
    'No review entries yet. Check/Act notes appear here after a review.',

  // 详情 / 删除
  '删除这条目标？会标记为「已放弃」并保留历史记录（有下级目标时会被拒绝）。':
    'Delete this goal? It will be marked Dropped and kept in history. Goals with sub-goals cannot be deleted.'
};

const LABELS = {
  '工作日': 'Workday',
  '非工作日': 'Non-workday',
  '日计划': 'Day',
  '周计划': 'Week',
  '月计划': 'Month',
  '季度计划': 'Quarter',
  '年计划': 'Year',
  '三年计划': '3-year',
  '进行中': 'Active',
  '未完成': 'Missed',
  '已完成': 'Done',
  '已调整': 'Adjusted',
  '已放弃': 'Dropped',
  '待制定': 'To plan',
  '待复盘': 'To review',
  '工作': 'Work',
  '学习': 'Learning',
  '生活': 'Life',
  '健康': 'Health',
  '家庭': 'Family',
  '兴趣': 'Hobbies',
  '财务': 'Finance',
  '其他': 'Other',
  '睡觉': 'Sleep'
};

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function detect() {
  try {
    const saved = localStorage.getItem('pdca_lang');
    if (saved === 'en' || saved === 'zh') return saved;
    const c = document.cookie.match(/(?:^|;\s*)pdca_lang=(en|zh)/);
    if (c) return c[1];
    return /^zh/i.test(navigator.language || '') ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

let current = typeof document === 'undefined' ? 'zh' : detect();
if (typeof document !== 'undefined') document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';

export function getLang() {
  return current;
}

export function setLang(next) {
  current = next === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('pdca_lang', current); } catch { /* ignore */ }
  try { document.cookie = `pdca_lang=${current}; path=/; max-age=31536000; samesite=lax`; } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN';
  window.dispatchEvent(new Event('pdca:lang'));
}

export function useLang() {
  const [lang, set] = useState(current);
  useEffect(() => {
    const onChange = () => set(current);
    window.addEventListener('pdca:lang', onChange);
    return () => window.removeEventListener('pdca:lang', onChange);
  }, []);
  return lang;
}

export function t(zh, vars) {
  let out = current === 'en' ? (EN[zh] ?? zh) : zh;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

/** 只翻译 profile 里的内置标签；用户自定义模块名原样显示 */
export function label(v) {
  if (!v) return v;
  return current === 'en' ? (LABELS[v] ?? EN[v] ?? v) : v;
}

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function monthName(v) {
  const m = String(v ?? '').match(/^(\d{1,2})月/);
  return current === 'en' && m ? MONTHS_EN[Number(m[1]) - 1] : v;
}

export function weekdayName(i) {
  return (current === 'en' ? WEEKDAYS_EN : WEEKDAYS_ZH)[i] ?? '';
}
