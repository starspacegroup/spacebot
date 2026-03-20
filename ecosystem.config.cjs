module.exports = {
  apps: [
    {
      name: "spacebot-gateway",
      script: "src/lib/discord/gateway.js",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
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
      args: "tunnel run spacebot-prod",
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
  ],
};
