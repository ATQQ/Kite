// PM2 配置：以 Bun 为解释器，fork 4 个独立进程共享同一端口（Bun.serve reusePort:true）。
// 之所以不用 exec_mode: 'cluster'：PM2 的 cluster 模式依赖 Node 的 cluster 模块，无法直接
// 在 Bun 运行时下工作。改用 fork + instances=4，让内核 SO_REUSEPORT 做负载均衡。
//
// 使用方式（在本目录执行）：
//   pm2 start ecosystem.config.cjs
//   pm2 logs kite-backend-api
//   pm2 restart kite-backend-api
//   pm2 delete kite-backend-api
//
// 每个实例的日志被 PM2 拆到 logs/out-<pm_id>.log / logs/err-<pm_id>.log
// （merge_logs:false 时 PM2 会自动在基名后追加 -<pm_id>），
// 方便在 Kite 「运行日志」页面导入后进行分屏对比。

const path = require('path')

module.exports = {
  apps: [
    {
      name: 'kite-backend-api',
      script: 'src/index.ts',
      cwd: __dirname,
      interpreter: 'bun',
      exec_mode: 'fork',
      instances: 4,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        PORT: '4301',
        NODE_ENV: 'production'
      },
      // 每个实例独立日志文件：PM2 在 merge_logs=false（默认）且 instances>1 时，
      // 会自动在 out_file / error_file 的基名后追加 -<pm_id>。
      // 因此这里只写基础文件名，最终产物是：
      //   logs/out-0.log  logs/out-1.log  logs/out-2.log  logs/out-3.log
      //   logs/err-0.log  logs/err-1.log  logs/err-2.log  logs/err-3.log
      out_file: path.join(__dirname, 'logs/out.log'),
      error_file: path.join(__dirname, 'logs/err.log'),
      merge_logs: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }
  ]
}
