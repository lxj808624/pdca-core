# 产品待办（核心版）

## 已完成

- [x] M1 建仓 + 世界观配置层（`profile/`）+ 部署层去个人化
- [x] M2 后端裁剪：只剩 `goals` + `meta`；删掉 queue / habits / timeline / slot-moves / daily-logs / focus / push 七组路由
- [x] M3 前端裁剪：三页（当下 / 目标链 / 复盘）+ 目标详情抽屉，全部运行时读 `/api/profile`
- [x] M4 Agent Skill 重写（`agent/skills/pdca/{SKILL,flows,reference}.md`）
- [x] M5-1 Node 版本声明：`package.json` 加 `engines: >=22.13.0`；新增 `server/start.js` 启动自检（版本不足打印中文指引并 exit 1）；`npm start` / systemd 统一走它
- [x] M5-2 首启引导：`/api/now` 增 `goalCount`；空库时当下页显示「三步上手」卡片（接 Agent → 建年目标 → 拆到今天），附 curl 与演示数据入口
- [x] M5-3 备份 / 恢复：`server/backup.js` + `deploy/backup.sh`（先 `wal_checkpoint(TRUNCATE)`，连 profile 与 ndjson 一起归档，保留最近 10 份）、`deploy/restore.sh`（覆盖前另存 pre-restore）
- [x] M5-4 演示数据：`npm run seed:demo` 按「今天」生成 7 条当前周期目标（自动落在当前排班模块、自动带子业务线词，导入即能在当下页看见）
- [x] M5-5 seed 示例与提示：`data/seed.example.ndjson`（5 行可照抄）；缺文件时打印三条可选路径而不是裸报错
- [x] M5-6 节假日日历：内置 2026、2027（国办发明电〔2026〕10 号）；新增 `PDCA_CALENDAR` 外部 JSON 覆盖机制；未收录年份在当下页显示提示条
- [x] M5-7 交付文档：README 重写（30 秒上手 / 鉴权 / 世界观 / 日历维护 / 备份恢复 / 运维 FAQ）、`docs/screenshots/` 三张截图、`LICENSE`
- [x] M5-8 前端补充：目标链页底部补「命名规范」速查；`export.js` 的维度清单改读 profile，不再写死

## 已完成的交付收尾（M7，2026-11-17）

- [x] 私有仓落在 `lxj808624/pdca-core`
- [x] 默认世界观换成中性示例（工作 / 学习 / 生活 / 健康），个人配置走 `profile/local.json`
- [x] AGPL-3.0-or-later 授权（`LICENSE` + `package.json`）
- [x] 冒烟测试 `npm test`（`scripts/smoke.sh` + `smoke.mjs`，23 项）
- [x] 演示数据按用户模块生成，自定义模块 / 无时段表也能用
- [x] README 重写：录入 UI、模块优先级（`meta.modules` > `profile.modules`）、排障表
- [x] 截图重拍（当下 / 目标链 / 新建目标 / 复盘 / 空库引导）
- [x] `CHANGELOG.md` + tag `v0.1.3`（历史压缩后仅保留此 tag）
- [x] 仓库开源（2026-11-17，v0.1.3）

## 后续优化

- [ ] **每年 11 月更新 `server/calendar.js`**：国务院发布次年放假安排后补录（或直接写 `PDCA_CALENDAR` 外部 JSON，不必改代码）
- [ ] 临时覆盖：手动把某天指定为工作日 / 非工作日
- [ ] 目标名称解析再放宽：日/周/月/季/年各有一套前缀写法，考虑支持纯日期写法
- [ ] 前端：目标详情里提供「复制为 curl」，方便用户贴给 Agent 改
- [ ] 迁移工具：补 dry-run 说明（`npm run snapshot` 已有）
- [ ] 文档：补一份「从零到第一条目标」的截图教程
