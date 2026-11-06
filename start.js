const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.chdir(__dirname);
if (!fs.existsSync('.env')) {
  fs.copyFileSync('.env.example', '.env', fs.constants.COPYFILE_EXCL);
  console.log('Created .env. Add your API key and restart for AI generation; demo mode works now.');
}
const packages = ['grapesjs/dist/grapes.min.js', 'dompurify/dist/purify.min.js'];
if (packages.some((file) => !fs.existsSync(path.join('node_modules', file)))) {
  console.log('Installing locked dependencies (first start only)...');
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    console.error('Please start using npm start.');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-fund'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
require('./server').start();
