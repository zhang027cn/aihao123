// pm2 托管 AI Hao123 摘要服务（CommonJS，pm2 可识别）
// 用法：pm2 start deploy/aihao-summary.config.js
// key 从 /etc/aihao-summary.env 注入（不写入本文件，防止入库）
const fs = require('node:fs');

let env = {};
try {
  const raw = fs.readFileSync('/etc/aihao-summary.env', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no env file */ }

module.exports = {
  apps: [
    {
      name: 'aihao-summary',
      script: '/opt/aihao123/scripts/summary-server.mjs',
      cwd: '/opt/aihao123',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        ...env,
        SUMMARY_PORT: '8790',
        NODE_ENV: 'production',
      },
    },
  ],
};
