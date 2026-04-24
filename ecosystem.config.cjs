module.exports = {
  apps: [
    {
      name: 'homework-v2',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100 -H 0.0.0.0',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '1024M',
      time: true,
      env: {
        NODE_ENV: 'production',
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`,
      },
    },
  ],
};
