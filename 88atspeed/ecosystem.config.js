module.exports = {
  apps: [{
    name: '88atspeed',
    script: 'app.js',
    cwd: '/var/www/88atspeed',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1536M',
    env: {
      NODE_ENV: 'production',
      PORT: 3023,
      HOST: '127.0.0.1',
      CHROME_PATH: '/usr/bin/google-chrome-stable',
      ADMIN_PASSWORD: 'yonetim2026',
      ADMIN_SESSION_SECRET: 'production-degistirin-guclu-bir-anahtar'
    }
  }]
};
