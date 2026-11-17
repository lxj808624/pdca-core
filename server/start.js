// 启动入口：先做环境自检，再加载真正的服务。
//
// 为什么要有这一层：服务依赖 Node 内置的 `node:sqlite`。它在 22.5 出现，但 22.13 之前要挂
// `--experimental-sqlite` flag 才能用；本项目按「开箱即用」要求 v22.13.0+（或 v23.4+ / v24+）。
// 如果直接在 index.js 里 import，低版本 Node 只会在链接阶段抛
//   `Cannot find module 'node:sqlite'`
// 使用者看不出是版本问题。这里先判断版本，给出能照着做的一句话指引。
//
// 用法：node server/start.js（npm start / systemd 都走这里）
const REQUIRED = { major: 22, minor: 13 };

function versionOf(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? ''));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

const cur = versionOf(process.versions.node);
const ok = cur && (
  (cur.major === 22 && cur.minor >= 13) ||
  (cur.major === 23 && cur.minor >= 4) ||
  cur.major >= 24
);

if (!ok) {
  console.error('');
  console.error(`✗ Node 版本过低：当前 v${process.versions.node}，本项目需要 v${REQUIRED.major}.${REQUIRED.minor}.0+（或 v23.4.0+ / v24+）`);
  console.error('  原因：数据库用 Node 内置的 node:sqlite；22.13 之前要额外开 flag，本项目不依赖 flag。');
  console.error('  做法：nvm install 22 && nvm use 22    （或到 https://nodejs.org 下载 22 LTS 最新版）');
  console.error('  验证：node -v  应显示 v22.13.0 或更高');
  console.error('');
  process.exit(1);
}

await import('./index.js');
