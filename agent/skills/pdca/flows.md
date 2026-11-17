# PDCA Core · 流程

> 所有流程的写操作都走 REST API，且必须过 `validate.js`。
> 被拦下来时读 `errors` 再改，不要换着写法硬试。

---

## §1 建档：从零到能用的最小一组目标

新用户第一次上手，按「年 → 季 → 月 → 周 → 日」自上而下建。顺序不能反：父级不存在时子目标会被拦。

1. 拉 `/api/profile` 确认模块、维度、规则。
2. 建年目标（1–2 条足够）：
   ```bash
   curl -s -X POST $PDCA_API/api/goals -H "Authorization: Bearer $PDCA_API_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"name":"2026年·完成核心版开源","module":"工作","dimension":"年计划","priority":"P0","plan":"…","kpi":"…"}'
   ```
   记下返回的 `goal.id`。
3. 建季度目标，`parent_id` 填年目标 id。
4. 建月目标（`11月：…`），`parent_id` 填季度目标 id。
5. 建周目标（`本周(11/10-11/16)·…`），`parent_id` 填月目标 id。
6. 建今日目标（`今日(11/11)·…`），`parent_id` 填周目标 id。

**判断是否建完**：`GET /api/now` 的 `moduleStatus` 里，`cadence=daily` 的模块应当有今日目标
（`hasTodayGoal=true`）；`GET /api/check` 的 `deviations` 里不再出现「今日目标未建」。

---

## §2 录入一条日目标（最高频）

用户说「今天要做 X」：

1. 判断模块：从 `/api/profile` 的模块清单里选最贴近的；有子业务线时名称里必须带（如「软件开发」）。
2. 名称前缀用今天日期：`今日(M/D)·<动作>`。
3. `plan` 写具体动作，`kpi` 写可验收的结果——这两项是复盘时的依据，别留空。
4. `parent_id` 尽量填本周目标；找不到就把父链空缺说出来，别硬编 id。
5. 写入后回读 `GET /api/now`，确认它进了 `ranked`（在当前时段模块）或 `offSlotGoals`（不在当前时段）。

用户只说了含糊的一句（「我要努力」），先问一句「具体做什么、怎么算完成」，再写。

---

## §3 改状态与复盘

| 用户说 | 动作 |
|-|-|
| 「这条做完了」 | `PATCH {"status":"已完成","check_note":"实际结果…"}` |
| 「没做完 / 只做了一半」 | `PATCH {"status":"未完成","check_note":"…"}`，并在 `act_note` 写下一步 |
| 「不做了」 | `PATCH {"status":"已放弃"}`，`act_note` 写原因 |
| 「改计划」 | `PATCH {"plan":"…"}`，必要时同时改 `kpi` |

复盘流程（Check）：
1. `GET /api/check` 看 `todayStats / weekStats / deviations`；
2. 对每个未完成目标问「卡在哪、下一步是什么」，把结论写进 `check_note / act_note`；
3. `GET /api/check` 再次确认 `deviations` 收敛。

---

## §4 周期审视

每周 / 每月末做一次，只看三件事：

1. **目标链完整性**：`GET /api/goals/chain` 或逐条 `GET /api/goals/:id`，看有没有断链（周目标没有月目标）。
2. **主线是否超限**：同模块 + 同子线 + 同维度 + 同周期的进行中目标 ≤ `RULES.mainlineLimit`；超了让用户砍。
3. **上周期遗留**：`GET /api/stats` 看各维度状态分布，把 `未完成` 的收尾或分解到下周期。

审视结论**不要**只写在对话里，落成目标：新建下一周期的目标，或 `PATCH` 旧目标状态。

---

## §5 改世界观（模块 / 维度 / 规则）

世界观是 `profile/default.json`，不是代码。改法：

1. 复制一份 `profile/local.json`（已被 `.gitignore` 排除）；
2. 改 `modules / dimensions / priorities / rules / schedule`；
3. 启动时 `PDCA_PROFILE=/abs/path/local.json npm start`；
4. 重启后 `GET /api/profile` 确认生效。

注意：
- 改 `dimensions` 会改变父链合法性，已有目标的 `dimension` 值也要同步改（`PATCH /api/goals/:id`）。
- 改模块名同理；旧值会在校验时报「模块必须是 …」，按提示批量改。
- 改 `schedule` 会改变「当前时段」，从而改变 `ranked` 与 `recommendation`。

---

## §6 提醒接入（使用者自己做）

核心版没有调度器，也不发消息。接入分三步：

### 6.1 拉数据

```bash
curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" "$PDCA_API/api/now"
```

取 `sleeping / activeTask / recommendation / ranked[0..2] / todayStats`。

### 6.2 组织一条提醒

- `sleeping === true` → 不发。
- 否则一句话：`【<activeTask.name>】<recommendation.task>`，再附前 3 条 `ranked` 的名字。
- 到 Check 时段再加一行：`今日 <done>/<total>`，以及 `GET /api/check` 的 `deviations`。

### 6.3 用你自己的调度器发出去

任何能定时执行 HTTP 请求的平台都可以：

| 平台 | 做法 |
|-|-|
| crontab | `*/30 9-22 * * * curl -s … /api/now` → 交给通知脚本 |
| 飞书 / 钉钉机器人 | 同一份 curl 结果拼成文本，POST 到机器人 webhook |
| 系统通知 | macOS `osascript -e 'display notification …'` / Linux `notify-send` |
| 你的 Agent 平台 | 建一个「每 30 分钟」的定时任务，让 Agent 自己拉、自己判断要不要说 |

**不要把提醒逻辑写回服务端。** 每个人的渠道、时段、语气都不同，写回服务端就等于又变回个人系统。

---

## §7 忘记带 token 的排查

| 现象 | 原因 |
|-|-|
| 所有接口 401 | 没带 `Authorization: Bearer`，或 token 与环境变量不一致 |
| 页面 302 到 `/login` | Cookie 过期（30 天未使用）或改了 `PDCA_PASSCODE` |
| 写接口 403 | Cookie 会话存在但 `Origin` 与站点不同源（跨站请求）；从本站页面操作，或改用 Bearer token |
| 接口 404 | 调了已移除的端点（queue / habits / timeline / slot-moves / daily-logs / focus / push），核心版没有这些 |
