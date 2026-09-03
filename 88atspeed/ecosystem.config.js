module.exports = {
  apps: [{
    name: '88atspeed',
    script: 'app.js',
    cwd: '/var/www/88atspeed',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1536M',
    max_restarts: 15,
    min_uptime: 8000,
    exp_backoff_restart_delay: 2000,
    env: {
      NODE_ENV: 'production',
      PORT: 3023,
      HOST: '127.0.0.1',
      CHROME_PATH: '/usr/bin/google-chrome-stable',
      PUPPETEER_EXECUTABLE_PATH: '/usr/bin/google-chrome-stable',
      ADMIN_PASSWORD: 'yonetim2026',
      ADMIN_SESSION_SECRET: 'production-degistirin-guclu-bir-anahtar'
    }
  }]
};
