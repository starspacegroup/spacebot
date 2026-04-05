const apiBase = process.env.API_BASE || process.env.APP_URL || "https://spacebot.starspace.group";

module.exports = {
  apps: [
    {
      name: "spacebot-gateway",
      script: "src/lib/discord/gateway-launcher.cjs",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        API_BASE: apiBase,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      // Logging
      error_file: "logs/gateway-error.log",
      out_file: "logs/gateway-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 30000,
      // Watch (disabled in production — enable for dev if desired)
      watch: false,
    },
    {
      name: "spacebot-tunnel",
      script: "cloudflared",
      args: "tunnel run spacebot",
      // Restart policy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      // Logging
      error_file: "logs/tunnel-error.log",
      out_file: "logs/tunnel-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 30000,
      watch: false,
    },
    {
      name: "spacebot-deploy",
      script: "scripts/deploy-webhook.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      // Logging
      error_file: "logs/deploy-error.log",
      out_file: "logs/deploy-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      watch: false,
    },
    {
      name: "spacebot-cron",
      script: "scripts/cron.js",
      interpreter: "node",
      args: "--experimental-specifier-resolution=node",
      env: {
        NODE_ENV: "production",
        API_BASE: apiBase,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 5000,
      // Logging
      error_file: "logs/cron-error.log",
      out_file: "logs/cron-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      watch: false,
    },
  ],
};
