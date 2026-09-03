const CHROME_ENV = {
  NODE_ENV: 'production',
  CHROME_PATH: '/usr/bin/google-chrome-stable',
  PUPPETEER_EXECUTABLE_PATH: '/usr/bin/google-chrome-stable',
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1',
  PUPPETEER_SKIP_DOWNLOAD: '1'
};

module.exports = {
  apps: [{
    name: '88atspeed',
    script: 'app.js',
    cwd: '/var/www/88atspeed',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '900M',
    node_args: '--max-old-space-size=512',
    max_restarts: 15,
    min_uptime: 8000,
    exp_backoff_restart_delay: 2000,
    env: {
      ...CHROME_ENV,
      PORT: 3023,
      HOST: '127.0.0.1',
      ADMIN_PASSWORD: 'yonetim2026',
      ADMIN_SESSION_SECRET: 'production-degistirin-guclu-bir-anahtar'
    }
  }, {
    name: '88atspeed-bitalih',
    script: 'scripts/bitalih-queue-worker.js',
    cwd: '/var/www/88atspeed',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1200M',
    max_restarts: 20,
    min_uptime: 5000,
    env: {
      ...CHROME_ENV
    }
  }]
};
