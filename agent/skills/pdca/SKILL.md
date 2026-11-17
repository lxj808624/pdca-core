# PDCA Core · Agent Skill

> 本文件是 PDCA Core 内置的 Agent 上岗手册。任何 Agent 接手这套系统，先读完本文件再动手。
>
> **核心版只做两件事：目标链（Plan）+ 当下引擎（Do/Check 的「现在该做什么」）。**
> 小事队列、习惯打卡、时间线、时段借调、今日强制、每日复利、飞书推送、大屏、注意力阶梯
> 都已在核心版移除（见 `docs/SCOPE.md`）。**不要因为前端没有入口就去造这些功能。**

---

## 1. 定位与边界

| 谁 | 做什么 |
|-|-|
| 后端 | 唯一事实源：SQLite + REST API + 硬校验。写入违规直接 400/409 |
| 前端 | 三个页面（当下 / 目标链 / 复盘）+ 录入表单。页面写入走同源 Cookie（登录后可见按钮）；Agent 与脚本写入仍走 Bearer token，两者过后端同一套校验 |
| Agent（你） | **主写入通道**：目标的新增、修改、状态流转走 `POST/PATCH/DELETE /api/goals`（页面表单也能写，两条通道同一套校验） |

所以用户说「帮我立个目标」「这条完成了」「挪到下个月」，都落到 `goals` 表的一次写操作，
并且必须过 `validate.js` 的规则。页面里也有录入表单，用户想自己点就自己点；你负责对话式录入与语义校验。

---

## 2. 数据通道

| 属性 | 值 |
|-|-|
| API 地址 | `http://localhost:3000`，可用 `PDCA_API` 覆盖（如 `http://127.0.0.1:3121`） |
| 数据库 | SQLite，路径由 `PDCA_DB` 指定，默认 `data/pdca.db`（服务端独占，**禁止**直接改库） |
| 世界观配置 | `profile/default.json`，可用 `PDCA_PROFILE` 指向任意绝对路径 |
| 健康检查 | `GET /api/health`（无需鉴权） |

### 鉴权

| 场景 | 凭据 |
|-|-|
| 浏览器 | 访问口令 → `pdca_session` Cookie（30 天，活跃自动续期） |
| Agent / 脚本（读写） | `Authorization: Bearer <PDCA_API_TOKEN>` |

- 口令来源 `PDCA_PASSCODE`，token 来源 `PDCA_API_TOKEN`。**两者都未配置＝本地开发模式，读写全放行。**
- 写接口接受 Bearer token；登录后的页面用同源 Cookie 也能写（服务端校验 `Origin`，跨站 403）。
- 每次 curl 都要带 token，漏带一律 401——别误判成「服务挂了」。

---

## 3. 先读世界观，再动手

**永远不要凭记忆假设模块名、维度名、状态名。** 每次接手先拉一次：

```bash
curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" http://localhost:3000/api/profile
```

返回：

```json
{
  "brand": { "appName": "PDCA Core", "loginTitle": "…" },
  "modules": [{ "name": "工作", "pillar": "work", "cadence": "daily", "subLines": [] }, { "name": "健康", "pillar": "health", "cadence": "weekly" }],
  "pillars": [{ "key": "work", "label": "工作" }, { "key": "health", "label": "健康" }],
  "dimensions": ["三年计划", "年计划", "季度计划", "月计划", "周计划", "日计划"],
  "priorities": ["P0", "P1", "P2"],
  "statuses": ["进行中", "未完成", "已完成", "已调整", "已放弃"],
  "rules": { "mainlineLimit": 3, "requirePriority": true, "requireParentChain": false, "subLineSplit": true },
  "timezone": "Asia/Shanghai"
}
```

- `modules[].cadence`：`daily` 需要每天有日目标；`weekly` 按周验收；`none` 不催办（用户仍可自己立目标）。
- `modules[].subLines`：有子业务线的模块，目标名称**必须**写明是哪条线（由 `rules.subLineSplit` 控制）。
- `dimensions` 按**高周期 → 低周期**排列，相邻即父子关系。

---

## 3.1 首次上手：先把分类定下来

空库第一次接手，先问用户一句「目标要不要分类」，而不是直接按 profile 默认模块建目标。

```bash
# 不分类：所有目标放一张清单（模块内部统一叫「目标」）
curl -s -X POST http://localhost:3000/api/setup \
  -H "Authorization: Bearer $PDCA_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"modules": [], "timeBlocks": false}'

# 分类：用用户自己说的名字（最多 8 个，每个 ≤12 字）
curl -s -X POST http://localhost:3000/api/setup \
  -H "Authorization: Bearer $PDCA_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"modules": ["工作", "副业"]}'
```

- `timeBlocks:false` 表示不用时段表，当下页只按优先级排序；用户想要作息表就传 `true` 或不传。
- 空数组 `[]` = 单清单；数组 = 自定义分类。**分类一旦定下，后续新建目标的 `module` 必须用这里的名字。**
- 已有目标后改分类，旧目标会因模块不在新值域而从清单里消失，所以只在开头定一次；用户后来要改，先确认影响再调。

---

## 4. 命名规范（引擎按名称识别周期）

「当下引擎」不存额外日期字段，靠目标名称前缀判断属于哪一天 / 哪一周。**必须按规范起名**：

| 维度 | 规范写法 | 例子 |
|-|-|-|
| 年计划 | `YYYY年·…` | `2026年·完成核心版开源` |
| 季度计划 | `Q{1-4}·…` 或 `第{1-4}季度·…` | `Q4·前端裁剪` |
| 月计划 | `{M}月：…`（也认 `{M}月·`） | `11月：打磨核心版` |
| 周计划 | `本周(M/D-M/D)·…` | `本周(11/10-11/16)·验收当下页` |
| 日计划 | `今日(M/D)·…`（也认 `M月D日·…`） | `今日(11/11)·验收当下页` |
| 三年计划 | 任意 | `2025-2027·…` |

识别规则在 `server/now.js` 的 `parseDayGoal / parseWeekGoal / parseMonthGoal`。
改规范就要同步改那里，否则目标不会出现在「今天」。

---

## 5. 写入：一条目标的完整字段

```bash
curl -s -X POST http://localhost:3000/api/goals \
  -H "Authorization: Bearer $PDCA_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "今日(11/11)·验收当下页",
    "module": "工作",
    "dimension": "日计划",
    "priority": "P0",
    "status": "进行中",
    "parent_id": "<周目标的 id>",
    "plan": "起服务截图检查三张页面",
    "kpi": "页面无报错、数据可读"
  }'
```

| 字段 | 必填 | 说明 |
|-|-|-|
| `name` | ✅ | 必须带周期前缀（见上表） |
| `module` | ✅ | `profile.modules[].name`，或带子业务线的时段写法 |
| `dimension` | ✅ | `profile.dimensions` 之一 |
| `priority` | 视规则 | `RULES.requirePriority` 为真时必填 |
| `status` | | 默认 `进行中` |
| `parent_id` | 视规则 | 上级目标 id；多父级用 `;` 分隔 |
| `plan` / `kpi` / `do_note` / `check_note` / `act_note` / `est_effort` | | 文字字段 |

状态流转用 `PATCH /api/goals/:id`：`{"status":"已完成","check_note":"…"}`。
改结构前先 `GET /api/goals/:id`（返回 `goal` / `chain` / `children`），别盲改。

---

## 6. 会被后端拦下的常见违规

| 违规 | 返回 | 说明 |
|-|-|-|
| 模块名不在值域 | 400 | 先读 `/api/profile` |
| 名称缺子业务线 | 409 | 只有配置了 `subLines` 的模块才要求写子线（默认示例不要求） |
| 同组主线超限 | 409 | 同模块+同子线+同维度+同周期，进行中上限 `RULES.mainlineLimit` |
| 父目标不存在 / 维度不对 | 400 | 父级必须是更高周期 |
| 缺必填优先级 | 400 | `RULES.requirePriority` 为真时 |
| 重复目标 | 409 | 同名同维度视为重复 |

被拦下时**不要重试同一份 payload**：读 `errors` 数组，按提示补字段或换措辞，必要时回问用户。

---

## 7. 读当下：`GET /api/now`

只需关心这几个字段：

| 字段 | 用途 |
|-|-|
| `recommendation` | 一句话「现在该做什么」（`task` + `reason`），可直接发给人 |
| `ranked` | 当前时段该做的清单，含 `score` 与 `aligned` |
| `offSlotGoals` | 不属于当前时段但今天仍要完成的（折叠备查） |
| `activeTask` / `activeModules` / `nextTask` | 当前时段与下一档 |
| `moduleStatus` | 每个模块今天的目标完成情况 |
| `todayStats` | `done/total` |
| `goalCount` | 全库目标总数；为 0 说明是空库，先引导建第一条年目标 |
| `today.calendarCoverage` | `exact` = 该年节假日已收录；`fallback` = 只按周末判定，提醒使用者补日历 |
| `sleeping` | 是否在睡眠时段（此时别催人做事） |

`GET /api/check` 给 `todayStats / weekStats / moduleRates / deviations / reviewTimeline`，用于复盘与偏差提醒。

---

## 8. 提醒与闭环：核心版不自带调度器

核心版**不内置**定时推送、站内提醒、群消息。提醒归使用者自己的平台：

1. 定时拉 `GET /api/now`，取 `recommendation.task` + `ranked` 前 3 条；
2. 按使用者自己的渠道发出去（飞书机器人 / 微信 / 系统通知 / 语音）；
3. 时段切换、日结束时拉 `GET /api/check`，把 `deviations` 一起报出来；
4. 「睡前不打扰」先看 `sleeping === true`，为真就不发。

配方见 `flows.md §6`。**不要给核心版加回 push 路由**——那是每个使用者自己该定的东西。

---

## 9. 相关文件

| 文件 | 内容 |
|-|-|
| `SKILL.md`（本文件） | 定位、通道、世界观、命名规范、写入字段、拦截规则 |
| `flows.md` | 各流程完整步骤（建档 / 录入 / 改状态 / 复盘 / 提醒接入） |
| `reference.md` | API 速查、字段定义、错误码、常用查询 |
| `../../server/validate.js` | 校验规则的真正实现（以代码为准） |
| `../../profile/default.json` | 默认世界观 |
| `../../docs/SCOPE.md` | 保留 / 移除清单与里程碑 |
