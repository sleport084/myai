module.exports = {
  apps: [{
    name: 'myai-admin',
    script: 'server.js',
    cwd: '/www/wwwroot/zy.tangdou2027.top',
    env: {
      NODE_ENV: 'production',
      ADMIN_PORT: 3000,
      JWT_SECRET: 'change-this-secret-in-production-2024',
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '256M',
  }]
}
