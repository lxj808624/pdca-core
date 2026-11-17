# AGENTS.md — PDCA Core · Agent 上岗手册

> 任何 Agent（Claude / GPT / 豆包 / 其他）进入本项目，从这里开始。读完本文件 + `agent/skills/pdca/` 的 SKILL.md 与 flows.md，你就是一个合格的 PDCA 助理。

## 这个项目是什么

目标管理系统：按 PDCA 循环管理「三年 → 年 → 季度 → 月 → 周 → 日」六级目标链，并在任意时刻回答「现在该做什么」。

当前是**核心版**：只保留目标链 + 当下引擎 + Plan/Check。小事队列、习惯、时间线、时段借调、每日复利、飞书推送、注意力阶梯、大屏档已删除（见 `docs/SCOPE.md`）。

**项目即平台，Agent 只是可替换的执行器**：规则、校验、流程知识都内置在项目里，换任何 Agent 都不丢能力。

## 世界观是可配置的

`profile/default.json` 定义模块、支柱、维度、优先级、校验强度与时段表。**不要把这些名字写进代码或文档**——需要至少先读 `/api/profile`，按使用者自己的配置说话。

若 `/api/profile` 返回的模块与你记忆中的不同，一律以接口返回为准。

## 快速上岗（5 步）

1. 启动服务（未运行时 `npm start`），确认 `curl -s localhost:3000/api/health` 返回 `{"ok":true,...}`
2. `curl -s -H "Authorization: Bearer $PDCA_API_TOKEN" localhost:3000/api/profile` 读取世界观（模块 / 支柱 / 维度 / 规则）；配了口令时这条不带 token 会 401
3. 读 `agent/skills/pdca/SKILL.md`（系统概述、命名规范、拦截规则）→ `flows.md`（录入 / Plan / Check / 审视的完整步骤）→ `reference.md`（API 端点与字段速查）
4. 认清职责：你是「流程引导者 + 语义校验者」；后端是「规则执行者」。你**不能也不需要**绕过后端
5. 改完代码必须验证：`npm run build` + `node --check server/*.js` + 打到 `/api/now` 看响应

## 数据通道

- 唯一入口是 REST API，**禁止直连 `data/pdca.db`**
- 写接口接受 `Authorization: Bearer <PDCA_API_TOKEN>`；页面表单用同源 Cookie 也能写（同一套校验）
- 若实例不在本机：以用户给的地址为准（`http://<host>:<port>` 或反代域名），不要默认 `localhost:3000`
- 读接口在配置了口令后也需要会话或 token（`/api/health` 与 `/api/profile` 除外，按部署配置）

## 定时提醒归属

核心版**不自带调度器**。提醒由使用者自己的平台（Claude/豆包定时任务、cron、WorkBuddy 等）承担，触发时调用本项目 API 即可：

```
GET  /api/now        → 现在该做什么、下一节点、今日缺口
GET  /api/check      → 今日完成率与偏差
POST /api/goals      → 录入/更新（需 token）
```

写一份提醒规则时只做两件事：先读 `dayType` 与当前时段，再决定提醒哪个模块；**非交互场景只读不写**，把建议发给用户，写入等用户确认。

## 红线

1. 不直连数据库、不直连飞书
2. 写接口返回 400/409 时，把 `errors` 转述给用户引导修正，禁止换姿势重试
3. 非交互（定时/自动触发）场景禁止任何写接口与文件改动
4. 改代码后必须跑构建与语法检查
