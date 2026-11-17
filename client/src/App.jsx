import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchProfile, fetchNow, fetchGoals, fetchCheck, fetchGoal, createGoal, updateGoal, deleteGoal, logout, saveSettings, saveModules } from './api.js';

// ============================================================
// PDCA Core · 前端
//
// 页面只有三个（目标链 + 当下引擎）：
//   当下  — 现在该做什么（后端 buildNowPayload 决定，前端只呈现）
//   目标链 — Plan：三级以上目标的全景与筛选
//   复盘  — Check：完成率 / 偏差 / 复盘时间线
//
// 所有模块、支柱、维度、优先级都由 /api/profile 在运行时给出，
// 前端不留任何世界观硬编码——换 profile 就换一套系统。
// ============================================================

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 模块基名：剥掉子业务线后缀，把「工作 开发」归回「工作」
function baseModule(v, modules) {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  for (const m of modules) {
    if (raw === m.name) return m.name;
    const subs = m.subLines ?? [];
    const hit = subs.find((s) => raw === `${m.name} ${s}` || raw === `${m.name}·${s}` || raw === `${m.name}（${s}）`);
    if (hit) return m.name;
    if (raw.startsWith(m.name)) return m.name;
  }
  return raw;
}

const P_ICON = { P0: 'P0', P1: 'P1', P2: 'P2' };

function PrioChip({ p }) {
  if (!p) return null;
  return <span className={`chip prio prio-${p}`}>{P_ICON[p] ?? p}</span>;
}

function StatusChip({ s }) {
  if (!s) return null;
  return <span className={`chip status status-${s}`}>{s}</span>;
}

// ---------- 数据 hook ----------

function usePeriodic(fn, ms = 60_000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    fn().then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e)));
  }, [fn]);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    const onChange = () => load();
    window.addEventListener('pdca:changes', onChange);
    return () => { clearInterval(t); window.removeEventListener('pdca:changes', onChange); };
  }, [load, ms]);
  return { data, error, reload: load };
}

// ---------- 顶栏 ----------

const PAGES = [
  { key: 'now', label: '当下' },
  { key: 'plan', label: '目标链' },
  { key: 'check', label: '复盘' }
];

function TopBar({ page, onPage, brand, clock }) {
  return (
    <header className="topbar">
      <span className="brand">{brand?.appName ?? 'PDCA Core'}</span>
      <nav className="nav-tabs">
        {PAGES.map((p) => (
          <button
            key={p.key}
            className={`nav-tab${page === p.key ? ' nav-tab-active' : ''}`}
            onClick={() => onPage(p.key)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <span className="clock">{clock}</span>
      <button className="topbar-out" onClick={async () => {
        try { await logout(); } catch { /* 会话已失效也照样跳转 */ }
        window.location.replace('/login');
      }}>退出</button>
    </header>
  );
}

// ---------- 当下 ----------

function NowSlot({ now }) {
  const { recommendation, today, timeBlocks, activeTask, todayStats, sleeping, sleep } = now;

  if (sleeping) {
    return (
      <section className="hero">
        <div className="hero-eyebrow">{today?.dateLabel} · {today?.weekday ? WEEKDAYS[today.weekday] : ''}</div>
        <h1 className="hero-headline">睡觉时间</h1>
        <p className="hero-detail">明早再继续。</p>
      </section>
    );
  }

  const task = recommendation?.task ?? (todayStats?.total ? '今天的事都做完了' : '今天还没有安排');
  const detail = recommendation?.reason ?? '';

  return (
    <section className="hero">
      <div className="hero-eyebrow">
        {today?.dateLabel} {today?.weekday ? WEEKDAYS[today.weekday] : ''}
        {timeBlocks === false
          ? ` · 今天 ${todayStats?.total ?? 0} 件，已完成 ${todayStats?.done ?? 0} 件`
          : activeTask ? ` · ${activeTask.time}–${activeTask.to ?? ''} ${activeTask.name}` : ''}
      </div>
      <p className="hero-kicker">{timeBlocks === false ? '先做这件' : '现在该做'}</p>
      <h1 className="hero-headline">{task}</h1>
      {detail ? <p className="hero-detail">{detail}</p> : null}
    </section>
  );
}

// 列表里只显示"事情本身"，周期前缀留给引擎和详情用
function stripName(name) {
  return String(name ?? '')
    .replace(/^\d{4}年[·：:/／\s]*/, '')
    .replace(/^今日\(\d{1,2}\/\d{1,2}\)[·：:/／\s]*/, '')
    .replace(/^本周\([^)]*\)[·：:/／\s]*/, '')
    .replace(/^第?[一二三四1-4]?季度[·：:/／\s]*/, '')
    .replace(/^Q\d[·：:/／\s]*/, '')
    .replace(/^\d{1,2}月[：:·][\s]*/, '');
}

function NowRow({ item, index, onOpen, singleModule }) {
  const showModule = !singleModule && item.module && item.module !== '目标';
  const showStatus = item.source === 'pdca' && item.status && item.status !== '进行中';
  return (
    <li className={`rec-item rec-${item.source}`} onClick={() => onOpen(item)} role="button" tabIndex={0}>
      <span className="rec-rank">{index}</span>
      <div className="rec-main">
        <div className="rec-name">
          {stripName(item.name)}
          <PrioChip p={item.priority} />
          {showModule ? <span className="chip module-chip">{item.module}</span> : null}
          {showStatus ? <StatusChip s={item.status} /> : null}
        </div>
        {item.source !== 'pdca' && item.reason ? <div className="rec-reason">{item.reason}</div> : null}
      </div>
    </li>
  );
}

function Onboarding({ profile, onCreate }) {
  // 第一次进来（还没分过模块）都先问一句：要不要分类
  const needModuleChoice = profile?.moduleChoice === 'default';
  const [step, setStep] = useState(needModuleChoice ? 'modules' : 'goal');
  const [picked, setPicked] = useState([]);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const PRESETS = ['工作', '学习', '健康', '家庭', '兴趣', '财务'];

  const save = async (modules) => {
    setBusy(true); setErr('');
    try {
      await saveModules(modules);
    } catch (e) {
      setErr(e.payload?.error || '没保存成功，再试一次');
      setBusy(false);
      return;
    }
    window.dispatchEvent(new Event('pdca:profile-changed'));
    window.dispatchEvent(new Event('pdca:changes'));
    setBusy(false);
    setStep('goal');
  };

  const toggle = (name) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : (p.length >= 8 ? p : [...p, name])));
  const withCustom = () => {
    const c = custom.trim();
    return c && !picked.includes(c) ? [...picked, c] : picked;
  };

  return (
    <section className="card onboard">
      <p className="onboard-eyebrow">第一次使用 · 两步就好</p>
      {step === 'modules' ? (
        <>
          <h2 className="onboard-title">你的目标要分类吗？</h2>
          <p className="onboard-lead">分类之后，目标会分到「工作 / 学习 / 健康」这样的格子里。不分类就是一张清单，更省事。</p>
          <div className="choice-list">
            <button className="choice-card" disabled={busy} onClick={() => save([])}>
              <b>就一张清单</b>
              <span>所有目标放在一起，按优先级排</span>
            </button>
            <button className="choice-card" disabled={busy} onClick={() => setStep('pick')}>
              <b>分几个类别</b>
              <span>每类单独一条线，适合事情多、方向杂</span>
            </button>
          </div>
          {err ? <p className="form-errors-inline">{err}</p> : null}
        </>
      ) : step === 'pick' ? (
        <>
          <h2 className="onboard-title">选几个类别</h2>
          <p className="onboard-lead">挑现成的，或者自己起名字，最多 8 个。之后想改跟 Agent 说一声。</p>
          <div className="chip-pick">
            {PRESETS.map((name) => (
              <button
                key={name}
                className={`pick-chip${picked.includes(name) ? ' pick-chip-on' : ''}`}
                onClick={() => toggle(name)}
              >{name}</button>
            ))}
          </div>
          <div className="custom-row">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="自己起一个，例如「副业」"
              maxLength={12}
            />
            <button className="btn-ghost" onClick={() => { if (custom.trim()) { toggle(custom.trim()); setCustom(''); } }}>加上</button>
          </div>
          {picked.length ? <p className="onboard-lead">已选：{picked.join(' / ')}</p> : null}
          {err ? <p className="form-errors-inline">{err}</p> : null}
          <div className="onboard-cta">
            <button className="btn-ghost" disabled={busy} onClick={() => setStep('modules')}>返回</button>
            <button className="btn-primary" disabled={busy || !picked.length} onClick={() => save(picked)}>
              {busy ? '保存中…' : '就这些'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="onboard-title">建第一个目标</h2>
          <p className="onboard-lead">
            {profile?.singleModule
              ? '写一句你要做成的事，选个时间范围就行。'
              : '写一句你要做成的事，选个类别和时间范围。'}
          </p>
          <div className="onboard-cta">
            <button className="btn-primary" onClick={onCreate}>建第一个目标</button>
          </div>
          <p className="onboard-foot">建完之后，它会出现在「今天」的清单里。</p>
        </>
      )}
    </section>
  );
}

function NowPage({ profile, onOpen, onCreate }) {
  const now = usePeriodic(fetchNow);
  if (now.error) return <div className="card error-card">加载失败：{now.error}</div>;
  if (!now.data) return <div className="card loading-card">加载中…</div>;

  const { activeTask, activeModules, nextTask, ranked, offSlotGoals, recommendation, sleeping, sleep, today, todaySlots, moduleStatus, todayStats, scoreRules, goalCount } = now.data;

  // 什么都还没有时，页面上只留「设置 + 建第一个目标」，不放推荐和清单
  if (goalCount === 0) {
    return <Onboarding profile={profile} onCreate={onCreate} />;
  }

  return (
    <>
      <NowSlot now={now.data} />



      {!sleeping ? (
        <section className="card">
          <h2 className="sec-title">
            今天还要做
            <span className="dim-stats">{todayStats.total - todayStats.done} 件未完成</span>
          </h2>
          {ranked.length ? (
            <ol className="rec-list">
              {ranked.map((it, i) => <NowRow key={`${it.source}-${it.id}`} item={it} index={i + 1} onOpen={onOpen} singleModule={profile?.singleModule} />)}
            </ol>
          ) : (
            <p className="module-empty-hint">今天没有要推进的目标。到「目标链」加一条就行。</p>
          )}

          {offSlotGoals?.length ? (
            <details className="offslot">
              <summary>今日其他时段/模块的目标（{offSlotGoals.length}）</summary>
              <ol className="rec-list">
                {offSlotGoals.map((it) => <NowRow key={it.id} item={it} index="·" onOpen={onOpen} singleModule={profile?.singleModule} />)}
              </ol>
            </details>
          ) : null}
        </section>
      ) : null}


      {todaySlots?.length ? (
        <details className="card">
          <summary>今天的时段安排（{today.dayTypeLabel}）</summary>
          <ul className="slot-list">
            {todaySlots.map((s) => (
              <li key={`${s.time}-${s.name}`} className={`slot-row${s.sleep ? ' slot-row-sleep' : ''}`}>
                <span className="slot-time">{s.time}–{s.to}</span>
                <span className="slot-name">{s.sleep ? s.name : s.module ?? s.name}</span>
                <span className="slot-type">{s.sleep ? '' : s.type}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

    </>
  );
}


// ---------- 新建 / 编辑目标（录入 UI） ----------
// 校验规则不在前端复刻：提交后由后端 validate.js 判定，400/409 的 errors 原样回显。

// 命名前缀：引擎靠它判断「当前周期」，这里只做提示与一键插入，不强行改写用户输入
function prefixFor(dimension, now) {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  if (/三年|长期|愿景/.test(dimension)) return '';
  if (/季/.test(dimension)) return `Q${Math.floor(d.getMonth() / 3) + 1}·`;
  if (/年/.test(dimension)) return `${y}年·`;
  if (/月/.test(dimension)) return `${m}月：`;
  if (/周/.test(dimension)) return now?.today?.weekLabel ? `本周(${now.today.weekLabel})·` : '';
  if (/日|天/.test(dimension)) return `今日(${m}/${day})·`;
  return '';
}

function subLineOf(moduleName, modules) {
  const raw = String(moduleName ?? '');
  const def = modules.find((x) => (x.subLines ?? []).some((v) => raw.includes(v)));
  if (!def) return { module: baseModule(raw, modules), subLine: '' };
  const sub = def.subLines.find((v) => raw.includes(v)) ?? '';
  return { module: def.name, subLine: sub };
}

function GoalForm({ profile, now, initial, defaultDimension, onClose, onSaved }) {
  const isEdit = Boolean(initial);
  const dims = profile.dimensions;
  const init = subLineOf(initial?.module, profile.modules);
  const [dimension, setDimension] = useState(initial?.dimension ?? defaultDimension ?? dims[dims.length - 1] ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  // 只有一个模块（用户选了「一张清单」）时不再让他选，直接挂在唯一模块上
  const onlyModule = profile.modules.length === 1 ? profile.modules[0].name : '';
  const [module, setModule] = useState(init.module || onlyModule);
  const [subLine, setSubLine] = useState(init.subLine);
  const [priority, setPriority] = useState(initial?.priority ?? 'P1');
  const [status, setStatus] = useState(initial?.status ?? '进行中');
  const [parentId, setParentId] = useState(initial?.parent_id ?? '');
  const [plan, setPlan] = useState(initial?.plan ?? '');
  const [kpi, setKpi] = useState(initial?.kpi ?? '');
  const [goals, setGoals] = useState([]);
  const [errs, setErrs] = useState([]);
  const [warns, setWarns] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchGoals().then((d) => { if (alive) setGoals(d.goals ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const idx = dims.indexOf(dimension);
  const parentDim = idx > 0 ? dims[idx - 1] : null;
  const parents = parentDim ? goals.filter((g) => g.dimension === parentDim && g.status !== '已放弃') : [];
  const moduleDef = profile.modules.find((m) => m.name === module);
  const subLines = moduleDef?.subLines ?? [];
  const prefix = prefixFor(dimension, now);

  const submit = async (e) => {
    e.preventDefault();
    setErrs([]); setWarns([]); setBusy(true);
    const body = {
      name: name.trim(),
      dimension,
      module: module ? (subLine ? `${module} ${subLine}` : module) : null,
      priority,
      status,
      parent_id: parentId || null,
      plan: plan.trim() || null,
      kpi: kpi.trim() || null
    };
    try {
      if (isEdit) await updateGoal(initial.id, body);
      else await createGoal(body);
      window.dispatchEvent(new Event('pdca:changes'));
      onSaved?.();
      onClose();
    } catch (err) {
      const list = err.errors?.length ? err.errors : [err.message];
      setErrs(list.map((x) => (typeof x === 'string' ? x : x.message ?? JSON.stringify(x))));
      setWarns(err.warnings ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <form className="goal-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="drawer-head">
          <h3>{isEdit ? '编辑目标' : '新建目标'}</h3>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {errs.length ? (
          <div className="form-errors">
            <b>没写进去，{errs.length} 条规则不通过：</b>
            <ul>{errs.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        ) : null}
        {warns.length ? (
          <div className="form-warns">
            <b>已保存，但建议补一下：</b>
            <ul>{warns.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}</ul>
          </div>
        ) : null}

        <label className="field field-lead">
          <span>要做成什么{prefix ? <button type="button" className="prefix-btn" onClick={() => {
            if (!name.startsWith(prefix)) setName(prefix + name);
          }}>插入「{prefix}」</button> : null}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={prefix ? `例：${prefix}把报价单发给客户并确认` : '例：三年内把团队做到 10 人'} required />
        </label>

        <div className="field-row">
          <label className="field">
            <span>时间范围</span>
            <select value={dimension} onChange={(e) => { setDimension(e.target.value); setParentId(''); }}>
              {dims.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="field">
            <span>优先级</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {profile.priorities.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          {onlyModule ? null : (
            <label className="field">
              <span>类别</span>
              <select value={module} onChange={(e) => { setModule(e.target.value); setSubLine(''); }}>
                {profile.modules.map((m) => <option key={m.name}>{m.name}</option>)}
              </select>
            </label>
          )}
          {subLines.length ? (
            <label className="field">
              <span>子类</span>
              <select value={subLine} onChange={(e) => setSubLine(e.target.value)} required>
                <option value="">请选择</option>
                {subLines.map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          ) : null}
        </div>

        {isEdit ? (
          <label className="field">
            <span>状态</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {profile.statuses.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
        ) : null}

        <details className="form-more">
          <summary>更多（可选）</summary>
          <label className="field">
            <span>挂到哪个上级目标</span>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!parentDim}>
              <option value="">{parentDim ? `不挂（上面没有${parentDim}）` : '已经是最上层'}</option>
              {parents.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>怎么算做成了</span>
            <textarea rows={2} value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="例：客户确认收到，款到账" />
          </label>
          <label className="field">
            <span>打算怎么做</span>
            <textarea rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="例：先切 2 个高价客户，每周复盘一次" />
          </label>
        </details>

        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? '保存中…' : (isEdit ? '保存' : '创建')}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- 目标链 ----------

function GoalRow({ g, profile, onOpen }) {
  return (
    <li className={`plan-row${g.status === '已完成' ? ' plan-row-done' : ''}`} onClick={() => onOpen(g)} role="button" tabIndex={0}>
      <div className="plan-row-main">
        <span className="plan-row-name">{stripName(g.name)}</span>
        <div className="plan-row-meta">
          <PrioChip p={g.priority} />
          {g.status !== '进行中' ? <StatusChip s={g.status} /> : null}
          {!profile?.singleModule && g.module ? <span className="chip module-chip">{g.module}</span> : null}
        </div>
        {g.plan ? <div className="plan-row-plan">{g.plan}</div> : null}
      </div>
    </li>
  );
}

function PlanPage({ profile, onOpen, newSignal = 0 }) {
  // ?new=1 直接打开新建表单（便于分享「去建目标」链接与截图验收）
  const [creating, setCreating] = useState(() => new URLSearchParams(window.location.search).get('new') === '1');
  useEffect(() => { if (newSignal > 0) setCreating(true); }, [newSignal]);
  const [module, setModule] = useState('');
  const [dimension, setDimension] = useState('');
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const { data, error } = usePeriodic(() => Promise.all([fetchGoals(), fetchNow()]).then(([g, n]) => ({ goals: g.goals, now: n })), 60_000);

  if (error) return <div className="card error-card">加载失败：{error}</div>;
  if (!data) return <div className="card loading-card">加载中…</div>;

  const { goals, now } = data;
  const current = new Set(now.currentGoalIds ?? []);
  const filtered = goals.filter((g) => {
    if (scope === 'current' && !current.has(g.id)) return false;
    if (scope === 'history' && current.has(g.id)) return false;
    if (module && baseModule(g.module, profile.modules) !== module) return false;
    if (dimension && g.dimension !== dimension) return false;
    if (status && g.status !== status) return false;
    if (query && !`${g.name} ${g.plan ?? ''} ${g.kpi ?? ''}`.includes(query)) return false;
    return true;
  });

  const groups = profile.dimensions.filter((d) => filtered.some((g) => g.dimension === d));
  const rest = filtered.filter((g) => !profile.dimensions.includes(g.dimension));

  return (
    <>
      <section className="card">
        <h2 className="sec-title">
          目标链全景
          <button className="btn-primary" onClick={() => setCreating(true)}>+ 新建目标</button>
        </h2>
        {goals.length === 0 ? (
          <p className="plan-intro-text">还没有目标。建第一条，它才有东西可看。</p>
        ) : (
          <p className="plan-intro-text">
            共 {goals.length} 条目标，当前周期 {current.size} 条。
          </p>
        )}
        <div className="plan-period">
          <span className="pill pill-light">今天 {now.today.dateLabel}</span>
          <span className="pill pill-light">本周 {now.today.weekLabel}</span>
          <span className="pill pill-light">{now.today.monthLabel}</span>
        </div>
      </section>

      {goals.length === 0 ? (
        <section className="card onboard">
          <p className="onboard-eyebrow">第一步</p>
          <h2 className="onboard-title">先建一个目标</h2>
          <p className="onboard-lead">写一句你要做成的事，选个时间范围；建完这里就会有链条和进度。</p>
          <div className="onboard-cta">
            <button className="btn-primary" onClick={() => setCreating(true)}>建第一个目标</button>
          </div>
        </section>
      ) : null}

      {goals.length > 0 ? (
      <section className="card filter-bar">
        <select aria-label="时间范围" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">全部时间</option>
          <option value="current">当前周期</option>
          <option value="history">历史周期</option>
        </select>
        {profile.singleModule ? null : (
          <select aria-label="模块" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">全部模块</option>
            {profile.modules.map((m) => <option key={m.name}>{m.name}</option>)}
          </select>
        )}
        <select aria-label="状态" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {profile.statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input aria-label="搜索目标" placeholder="搜索目标 / 计划 / KPI…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </section>

      ) : null}

      {groups.map((dim) => {
        const list = filtered.filter((g) => g.dimension === dim);
        const done = list.filter((g) => g.status === '已完成').length;
        return (
          <section key={dim} className="card">
            <h2 className="sec-title">
              {dim}
              <span className="dim-stats">{list.length} 条 · {done} 已完成</span>
            </h2>
            <ul className="plan-goal-list">
              {list.map((g) => <GoalRow key={g.id} g={g} profile={profile} onOpen={onOpen} />)}
            </ul>
          </section>
        );
      })}

      {rest.length ? (
        <section className="card">
          <h2 className="sec-title">其他维度</h2>
          <ul className="plan-goal-list">
            {rest.map((g) => <GoalRow key={g.id} g={g} profile={profile} onOpen={onOpen} />)}
          </ul>
        </section>
      ) : null}

      {goals.length > 0 && !filtered.length ? <div className="card module-empty-hint">没有匹配的目标。点上方「+ 新建目标」建第一条，或调整筛选条件。</div> : null}

      {profile.moduleChoice === 'default' ? (
        <details className="card">
          <summary>设置</summary>
          <div className="blocks-row">
            <span>按时间段安排：<b>{profile.timeBlocks ? '开启' : '关闭'}</b></span>
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                try { await saveSettings(!profile.timeBlocks); } catch { /* 失败就不改，页面保持原样 */ }
                window.dispatchEvent(new Event('pdca:profile-changed'));
              }}
            >改成{profile.timeBlocks ? '不分块' : '按时间段'}</button>
          </div>
        </details>
      ) : null}

      {creating ? (
        <GoalForm profile={profile} now={now} onClose={() => setCreating(false)} />
      ) : null}
    </>
  );
}

// ---------- 复盘 ----------

function Donut({ done, total, label }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="donut">
      <div className="donut-ring" style={{ '--pct': pct }}>
        <span className="donut-num">{pct}%</span>
      </div>
      <div className="donut-label">{label}</div>
      <div className="donut-sub">{done}/{total}</div>
    </div>
  );
}

function CheckPage({ profile }) {
  const { data, error } = usePeriodic(fetchCheck);
  if (error) return <div className="card error-card">加载失败：{error}</div>;
  if (!data) return <div className="card loading-card">加载中…</div>;

  const { today, todayStats, weekLabel, weekStats, moduleRates, deviations, reviewTimeline } = data;

  return (
    <>
      <section className="card">
        <h2 className="sec-title">完成情况 · {today.dateLabel}</h2>
        <div className="donut-row">
          <Donut done={todayStats.done} total={todayStats.total} label="今日目标" />
          <Donut done={weekStats.done} total={weekStats.total} label={`本周 · ${weekLabel}`} />
        </div>
      </section>

      <section className={`card ${deviations.length ? 'deviation-card' : 'deviation-ok-card'}`}>
        <h2 className="sec-title">{deviations.length ? `偏差提示 · ${deviations.length}` : '无偏差'}</h2>
        {deviations.length ? (
          <ul className="deviation-list">
            {deviations.map((d, i) => (
              <li key={i} className="deviation-item">
                <span className="deviation-type">{d.type}</span>
                <span className="deviation-detail">{d.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="module-empty-hint">目标齐全、主线数量合规、子业务线分离正常</div>
        )}
      </section>

      {profile.singleModule ? null : (
      <section className="card">
        <h2 className="sec-title">模块完成率（今日）</h2>
        <div className="rate-list">
          {moduleRates.map((m) => {
            const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
            const note = m.total === 0
              ? (m.cadence === 'weekly' ? '周更 · 按周验收'
                : m.cadence === 'none' ? '不设目标'
                  : m.scheduledToday === false ? '今日无排班' : '未建')
              : '';
            return (
              <div key={m.module} className="rate-row">
                <div className="rate-head">
                  <span className="rate-name">{m.module}</span>
                  <span className="rate-num">{m.done}/{m.total}{note ? ` · ${note}` : ''}</span>
                </div>
                <div className="rate-bar">
                  <div className="rate-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>
      )}

      <section className="card">
        <h2 className="sec-title">复盘时间线</h2>
        {reviewTimeline?.length ? (
          <ul className="timeline">
            {reviewTimeline.map((r) => (
              <li key={r.id} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-body">
                  <div className="timeline-head">
                    <span className="timeline-date">{(r.updated_at ?? '').slice(0, 10)}</span>
                    <span className="timeline-name">{r.name}</span>
                    <StatusChip s={r.status} />
                    <span className="timeline-dim">{r.dimension}</span>
                  </div>
                  {r.check_note ? <div className="timeline-note"><b>Check</b>{r.check_note}</div> : null}
                  {r.act_note ? <div className="timeline-note"><b>Act</b>{r.act_note}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="module-empty-hint">还没有复盘记录。完成 Check 流程后，check/act 笔记会出现在这里。</div>
        )}
      </section>
    </>
  );
}

// ---------- 目标详情抽屉 ----------

function DetailDrawer({ id, profile, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ver, setVer] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchGoal(id).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [id, ver]);

  const setStatus = async (status) => {
    setBusy(true); setNote(null);
    try {
      await updateGoal(id, { status });
      window.dispatchEvent(new Event('pdca:changes'));
      setVer((v) => v + 1);
    } catch (err) {
      setNote((err.errors?.length ? err.errors : [err.message]).join('；'));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm('删除这条目标？会标记为「已放弃」并保留历史记录（有下级目标时会被拒绝）。')) return;
    setBusy(true); setNote(null);
    try {
      await deleteGoal(id);
      window.dispatchEvent(new Event('pdca:changes'));
      onClose();
    } catch (err) {
      setNote((err.errors?.length ? err.errors : [err.message]).join('；'));
      setBusy(false);
    }
  };

  return (
    <div className="drawer-mask" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>目标详情</h3>
          <button className="drawer-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {error ? <p className="module-empty-hint">加载失败：{error}</p> : null}
        {!data && !error ? <p className="module-empty-hint">加载中…</p> : null}
        {data ? (
          <>
            {data.chain?.length ? (
              <section className="drawer-sec">
                <h4>目标链</h4>
                <ul className="chain-list">
                  {data.chain.map((c, i) => (
                    <li key={c.id} className={c.id === data.goal.id ? 'chain-cur' : ''} style={{ marginLeft: i * 12 }}>
                      <span className="chain-dim">{c.dimension}</span>
                      <span className="chain-name">{c.name}</span>
                      {c.id !== data.goal.id ? <StatusChip s={c.status} /> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="drawer-sec">
              <h4>{data.goal.name}</h4>
              <div className="drawer-meta">
                <PrioChip p={data.goal.priority} />
                <StatusChip s={data.goal.status} />
                {data.goal.dimension ? <span className="chip">{data.goal.dimension}</span> : null}
                {data.goal.module ? <span className="chip module-chip">{data.goal.module}</span> : null}
              </div>
              {[['Plan', data.goal.plan], ['KPI', data.goal.kpi], ['Do', data.goal.do_note], ['Check', data.goal.check_note], ['Act', data.goal.act_note]].map(([k, v]) => (
                v ? <div key={k} className="drawer-field"><b>{k}</b><p>{v}</p></div> : null
              ))}
            </section>

            {!editing ? (
              <section className="drawer-sec drawer-actions">
                <h4>调整</h4>
                <div className="status-row">
                  {profile.statuses.filter((x) => x !== data.goal.status).map((st) => (
                    <button key={st} className="btn-ghost" disabled={busy} onClick={() => setStatus(st)}>{st}</button>
                  ))}
                </div>
                {note ? <p className="form-errors-inline">{note}</p> : null}
                <div className="form-actions">
                  <button className="btn-ghost" onClick={remove} disabled={busy}>删除</button>
                  <button className="btn-primary" onClick={() => setEditing(true)} disabled={busy}>编辑</button>
                </div>
              </section>
            ) : null}

            {data.children?.length ? (
              <section className="drawer-sec">
                <h4>下级目标（{data.children.length}）</h4>
                <ul className="child-list">
                  {data.children.map((c) => (
                    <li key={c.id}>
                      <span className="chain-dim">{c.dimension}</span>
                      <span className="chain-name">{c.name}</span>
                      <StatusChip s={c.status} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.goal.change_log ? (
              <section className="drawer-sec">
                <h4>变更记录</h4>
                <ul className="changelog">
                  {String(data.goal.change_log).split(/\\n|\n/).filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        <p className="drawer-tip">表单与 Agent 共用同一套后端校验；表单被拦时会写清是哪条规则。</p>
      </aside>
      {editing && data ? (
        <GoalForm
          profile={profile}
          now={null}
          initial={data.goal}
          onSaved={() => setVer((v) => v + 1)}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}

// ---------- 根组件 ----------

export default function App() {
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  // 初始页读 hash（#plan / #check），切页时写回——便于分享定位与截图验收
  const [page, setPageState] = useState(() => {
    const h = window.location.hash.replace('#', '');
    return PAGES.some((p) => p.key === h) ? h : 'now';
  });
  const setPage = (p) => {
    setPageState(p);
    window.history.replaceState(null, '', p === 'now' ? window.location.pathname : `#${p}`);
  };
  const [detailId, setDetailId] = useState(null);
  const [newSignal, setNewSignal] = useState(0);
  const startCreate = () => { setPage('plan'); setNewSignal((n) => n + 1); };

  useEffect(() => {
    fetchProfile().then(setProfile).catch((e) => setProfileError(String(e)));
  }, []);
  // 改了偏好（如时间分块）后重新拉 profile，不整页刷新
  useEffect(() => {
    const reload = () => fetchProfile().then(setProfile).catch(() => {});
    window.addEventListener('pdca:profile-changed', reload);
    return () => window.removeEventListener('pdca:profile-changed', reload);
  }, []);

  // 每 30s 更新顶栏时钟
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      setClock(`${WEEKDAYS[d.getDay()]} ${hm}`);
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const ctx = useMemo(() => {
    if (!profile) return null;
    const map = {};
    for (const m of profile.modules) map[m.name] = m.pillar ?? null;
    return { ...profile, __map: map, __modules: profile.modules };
  }, [profile]);

  if (profileError) return <div className="wrap"><div className="card error-card">配置加载失败：{profileError}</div></div>;
  if (!ctx) return <div className="wrap"><div className="card loading-card">加载中…</div></div>;

  const open = (item) => setDetailId(item?.id ?? null);

  return (
    <div className="wrap">
      <TopBar page={page} onPage={setPage} brand={ctx.brand} clock={clock}  />
      {page === 'now' ? <NowPage profile={ctx} onOpen={open} onCreate={startCreate} /> : null}
      {page === 'plan' ? <PlanPage profile={ctx} onOpen={open} newSignal={newSignal} /> : null}
      {page === 'check' ? <CheckPage profile={ctx} /> : null}
      {detailId ? <DetailDrawer id={detailId} profile={ctx} onClose={() => setDetailId(null)} /> : null}
      <footer className="foot">{ctx.brand?.appName ?? 'PDCA Core'} · 目标链 + 当下引擎</footer>
    </div>
  );
}
