# SCOPE — PDCA Core 保留 / 移除清单

> 决策日期：2026-11-11（更新：2026-11-17 v0.1.3 开源）。
> 原则：**只保留「目标链 + 当下引擎」这一条主干**，提醒与流程引导交给使用者自己的 Agent。
> 状态：✅ 已完成 / 🚧 进行中 / ⬜ 待做

## 一、保留

| 能力 | 现状 | 说明 |
|---|---|---|
| 六级目标链（三年→日） | ✅ | `goals.parent_id` + `/api/goals/chain` |
| 目标详情与目标链追溯 | ✅ | `/api/goals/:id` 返回上级链 + 子目标 |
| Plan 页（目标全景） | ✅ | 按支柱着色、按周期/模块/状态筛选 |
| Check 页（完成率/偏差/复盘） | ✅ | 偏差规则与硬校验同源 |
| 当下引擎 | ✅ | 时段表 + 日型 + 当日目标打分 |
| 硬校验（主线/子业务线/目标链/优先级） | ✅ | 规则强度来自 `profile.rules` |
| 世界观配置化 | ✅ | `profile/default.json`，服务端与前端都不再持有模块名 |
| 访问鉴权（口令 Cookie + 写接口 Token） | ✅ | 读要登录；页面写入用同源 Cookie，脚本/Agent 写入用 Bearer token |
| Agent 上岗手册 | ✅ | `agent/skills/pdca/` 三份文档已按 core 重写 |
| systemd / nginx 部署 | ✅ | 已去掉个人服务器与域名（不提供 Docker，见 README「部署」） |

## 二、移除

| 模块 | 涉及代码（原本） | 现状 |
|---|---|---|
| 小事队列（queue） | 表 + 5 个路由 + `now.js` 打分 + `QueuePage` | ✅ 表/路由/前端全部删除 |
| 习惯打卡（habits / habit_logs） | 表 + 6 个路由 + `habitDueState` 整套 | ✅ 全部删除 |
| 时间线（timeline_events） | 表 + 4 路由 + `Timeline.jsx` | ✅ 全部删除 |
| 时段借调（slot_moves） | 表 + 4 路由 + 当下页借调区 | ✅ 全部删除 |
| 今日强制（focus_marks） | 表 + 4 路由 + `focusFallback` | ✅ 全部删除 |
| 每日复利（daily_logs） | 表 + 4 路由 + `Progress.jsx` | ✅ 全部删除 |
| 飞书群推送 | `push.js` + `/api/push` + config | ✅ 文件与路由删除 |
| 注意力阶梯 / 大屏 | `Attention.jsx`、`Kiosk.jsx` | ✅ 文件删除 |
| WorkBuddy 定时任务 | `agent/schedule/` 19 条 | ✅ 目录删除 |

`db.js` 现在只建两张表：`goals`（业务）与 `meta`（键值，如 seededAt）。新库不会再出现任何旧表。

## 三、里程碑

| # | 内容 | 验收 |
|---|---|---|
| M1 | 建仓 + 世界观配置层 + 部署层通用化 | ✅ `npm start` 起得来；`/api/profile` 返回配置；子业务线校验按 profile 生效 |
| M2 | 后端裁剪：只剩 `goals` + `meta`，路由从 1405 行降到 425 行，`now.js` 重写为「只有目标」的引擎 | ✅ 6 组端点全部 404；`/api/now` 19 字段；`POST /api/goals` 正常；违规目标被拦 |
| M3 | 前端裁剪到 3 页（当下 / 目标链 / 复盘）+ 目标详情抽屉；模块与支柱运行时读 `/api/profile` | ✅ 构建通过（160KB）；`App.jsx` 无模块名常量；三页截图可读 |
| M4 | Agent Skill 重写为 core 版 | ✅ 三份文档不再描述已移除能力；删除 `eval.sh` |
| M5 | 交付就绪：首启引导 + 备份/恢复 + Node 版本自检 + 2027 日历 + 演示数据 + 截图/FAQ/LICENSE | ✅ 空库引导卡可见；`seed:demo`/`backup` 实跑通过；2027 调休判定正确；部署只保留裸机（Docker 已移除） |
| M6 | 私有仓（GitHub private）+ 首个里程碑推送 | ✅ `lxj808624/pdca-core`（private，main） |
| M7 | v0.1.0 交付收尾：默认世界观中性化、AGPL 授权、冒烟测试、README/截图与代码对齐 | ✅ 默认 profile 换示例四类；`npm test` 23 项全绿；README 与录入 UI/模块优先级一致；截图重拍 |
| M8 | v0.1.3 开源：仓库转 public，README/LICENSE 去私有措辞 | ✅ GitHub 公开可匿名访问；Actions 绿 |

### toC 试用版（`PDCA_MODE=cloud`，2026-11-13 起；**2026-11-16 下线，代码已从 main 移除**）

> 下线原因：面向普通用户后，产品性质与「自托管模板」差别太大（账号、引导、模块划分、运营与隐私都要另做一套），决定只做自托管版。
> 处置：`server/cloud.js`、`deploy/*cloud*`、多租户路由与前端云入口已删除；下表 C1–C4 是最初的验收记录，留作历史；相关代码已从仓库移除。

定位：普通个人用户、先免费验证需求、轻量 Web、完整录入 UI。单仓双模式，引擎共用。

| # | 内容 | 验收 |
|---|---|---|
| C1 | 账号 + 一人一库隔离（`server/cloud.js`、请求级 `req.db`） | ✅ 两账号各得 `data/users/<uid>.db`；alice 建目标后 bob 仍为 0；伪造/过期 Cookie 401；single 模式不产生 `users.db` |
| C2 | 录入 UI：新建/编辑/删除/改状态 + 上级下拉 + 后端 `errors` 回显 | ✅ 目标链页「+ 新建目标」表单；详情抽屉编辑/改状态/删除；`errors`/`warnings` 原样回显 |
| C3 | 首启引导强化：注册后空库直接三步上手 + 一键导入演示数据 | ✅ cloud 首屏两键「导入演示数据 / 自己建第一条」；`POST /api/demo` 幂等（重复导入 409）；`/api/profile` 返回 `mode` 供前端分流 |
| C4 | 上线运营：域名/Nginx/systemd、按用户备份、注册限速、隐私说明与删号 | ✅ 旧 toC 域名（已下线，证书与 DNS 已清）；`deploy/pdca-cloud.service` + `nginx-cloud.conf`；`backup.js` 云端整目录快照 + `restore-cloud.sh`（实测）；`PDCA_SIGNUP_DAILY` 限流；`/privacy` + `DELETE /api/account`（实测删库） |

## 四、明确不做

- 多租户 / 账号体系 / 计费 —— **2026-11-16 定：不做**（cloud 实现曾做过，已随 toC 下线删除）；计费从未做
- i18n（先中文）
- 移动端专门适配（现有响应式够用）
- 站内提醒调度（提醒由使用者自己的 Agent 负责）
- ~~页面只读 / 写入只走 Agent~~ —— 已推翻：页面内有完整录入 UI（新建/编辑/删除/改状态），写入仍过后端 `validate.js`
