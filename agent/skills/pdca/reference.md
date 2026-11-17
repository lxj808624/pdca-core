# PDCA Core · 参考（API / 字段 / 错误）

## 1. 端点速查

| 方法 | 路径 | 鉴权 | 说明 |
|-|-|-|-|
| GET | `/api/health` | 否 | `{ ok, tz }`，部署与监控用 |
| GET | `/api/profile` | 是 | 世界观：brand / modules / pillars / dimensions / priorities / statuses / rules / timezone |
| GET | `/api/now` | 是 | 当下引擎（20 个字段，见 §3） |
| GET | `/api/check` | 是 | 复盘数据：今日/本周完成率、模块完成率、偏差、复盘时间线 |
| GET | `/api/goals` | 是 | 目标列表（`?limit=2000`） |
| GET | `/api/goals/chain` | 是 | 目标链视图 |
| GET | `/api/goals/:id` | 是 | 单目标 + `chain`（祖先）+ `children`（后代） |
| GET | `/api/week` | 是 | 本周概览（weekLabel / todayStats / weekGoals） |
| GET | `/api/stats` | 是 | 按维度 × 状态计数 |
| POST | `/api/goals` | 写 | 新建目标（硬校验） |
| PATCH | `/api/goals/:id` | 写 | 修改目标 |
| DELETE | `/api/goals/:id` | 写 | 删除目标 |
| POST | `/api/setup` | 写 | 首次定分类：`{"modules":[]}` 单清单 / `{"modules":["工作"]}` 自定义；可带 `timeBlocks` |
| GET | `/api/settings` | 是 | 读设置（时间分块开关等） |
| POST | `/api/settings` | 写 | 改设置：`{"timeBlocks": false}` |
| POST | `/api/login` | 否 | 口令换 Cookie |
| POST | `/api/logout` | 否 | 清 Cookie |
| GET | `/login` | 否 | 登录页 |

**已移除（调用即 404）**：`/api/queue*`、`/api/habits*`、`/api/timeline*`、`/api/slot-moves*`、
`/api/daily-logs*`、`/api/focus*`、`/api/push`；多租户接口 `/api/signup`、`/api/me`、`/api/account`、`/api/privacy` 也已随 ToC 下线。

---

## 2. 目标字段

| 字段 | 类型 | 说明 |
|-|-|-|
| `id` | string | 主键，`g_<时间戳base36>_<随机>` |
| `name` | string | 必填，含周期前缀（见 SKILL.md §4） |
| `module` | string | 模块基名或「基名 + 子业务线」 |
| `dimension` | string | `三年计划 / 年计划 / 季度计划 / 月计划 / 周计划 / 日计划` |
| `priority` | string | `P0 / P1 / P2`，可空（视 `RULES.requirePriority`） |
| `status` | string | `进行中 / 未完成 / 已完成 / 已调整 / 已放弃` |
| `parent_id` | string | 上级目标 id，多父级用 `;` 分隔 |
| `plan` | string | 计划（做什么） |
| `kpi` | string | 验收标准 |
| `do_note` / `check_note` / `act_note` | string | PDCA 三步的执行记录 |
| `est_effort` | string | 预计耗时 |
| `change_log` | string | 变更记录（服务端追加，一般不由 Agent 直接写） |
| `created_at` / `updated_at` | ISO string | 时间戳 |

---

## 3. `/api/now` 字段

| 字段 | 类型 | 说明 |
|-|-|-|
| `currentGoalIds` | string[] | 当前周期（今日/本周/本月/本季/本年/三年进行中）的目标 id |
| `sleeping` / `awake` | bool | 是否睡眠时段 / 用户是否声明「我还没睡」 |
| `recommendation` | object | `{ source, task, reason, score }`，`source ∈ sleep / planning / review / pdca / idle` |
| `serverTime` | ISO | 服务器时间 |
| `today` | object | `dateLabel / weekday / weekLabel / monthLabel / dayType / dayTypeLabel / holiday / calendarCoverage` |
| `sleep` | object | `start / end / module / label / tip` |
| `activeTask` | object\|null | `time / to / name / type / module / modules` |
| `activeModules` | string[] | 当前时段模块 |
| `todaySlots` | array | 当天全部时段条（`time / to / name / type / module / sleep`） |
| `nextTask` | object\|null | 下一档时段 |
| `advice` | object | `{ headline, detail }`，即 recommendation 的短句版 |
| `focus` | array | 今日未完成目标前 5 条（按优先级） |
| `moduleStatus` | array | 每模块 `{ module, pillar, scheduledToday, hasTodayGoal, goals }` |
| `weekGoals` | array | 本周目标（含 `parentName`） |
| `todayStats` | object | `{ total, done }` |
| `ranked` | array | 当前时段可做清单，按 `score` 降序 |
| `offSlotGoals` | array | 非当前时段模块的今日目标（折叠区） |
| `scoreRules` | object | 算分规则，前端用它解释排序 |

`ranked` / `offSlotGoals` 条目结构：

```json
{
  "source": "pdca | planning | review",
  "id": "…", "name": "…", "task": "…", "kpi": "…",
  "module": "…", "priority": "P0", "status": "进行中",
  "score": 90, "aligned": true, "overdueDays": 0,
  "reason": "…", "createdAt": "…"
}
```

---

## 4. 算分（`scoreRules`）

```
score = base(40) + priority(P0 25 / P1 15 / P2 8) + aligned(25) + overdue(min(5*天, 20))
上限 100；planning 候选固定 85，review 候选固定 90（压过普通目标）
```

`aligned` 为真＝该目标模块属于当前时段模块。不 aligned 的今日目标不进 `ranked`，进 `offSlotGoals`。

---

## 5. 错误码

| 状态码 | 场景 | 返回体 |
|-|-|-|
| 400 | 字段缺失 / 值域不对 / 父目标不合法 | `{ error, errors: [...], warnings: [...] }` |
| 401 | 未登录或 token 不对 | `{ error }` |
| 403 | 跨站 Cookie 写（`Origin` 不同源） | `{ error }` |
| 404 | 目标不存在，或调了已移除的端点 | `{ error }` |
| 409 | 子业务线未分离 / 主线超限 / 重复目标 | `{ error, errors }` |

---

## 6. 常用查询配方

```bash
# 今天该做什么（人看的版本）
curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" $PDCA_API/api/now \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['recommendation']['task']);[print('-',i['name']) for i in d['ranked'][:3]]"

# 今天有什么没做完
curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" $PDCA_API/api/now \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print([i['name'] for i in d['offSlotGoals']])"

# 偏差
curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" $PDCA_API/api/check \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(x['type'],x['detail']) for x in d['deviations']]"

# 某个目标的整条链
curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" $PDCA_API/api/goals/<id> \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(c['dimension'],c['name']) for c in d['chain']]"
```

---

## 7. 环境变量

| 变量 | 默认 | 说明 |
|-|-|-|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PDCA_DB` | `data/pdca.db` | SQLite 路径 |
| `PDCA_PROFILE` | `profile/default.json` | 世界观配置绝对路径 |
| `PDCA_PASSCODE` | 空 | 访问口令；空＝本地开发模式 |
| `PDCA_API_TOKEN` | 空 | Agent 写接口 token |
| `PDCA_SEED` | `data/seed.ndjson` | `npm run seed` 的导入源 |
| `PDCA_API` | — | Skill 文档里指向 API 的变量（给 Agent 用） |
