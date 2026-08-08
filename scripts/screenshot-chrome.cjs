const { execSync } = require('child_process');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = 'D:\\AllWorkSpace\\xiaobailong-new\\index.html';
const outputPath = 'D:\\AllWorkSpace\\xiaobailong-new\\ui-screenshot.png';
const cmd = `"${chromePath}" --headless --disable-gpu --screenshot="${outputPath}" --window-size=1440,900 --no-sandbox "${htmlPath}"`;
try {
  execSync(cmd, { timeout: 15000, stdio: 'pipe' });
  console.log('DONE');
} catch (e) {
  console.error('Error:', e.message);
}
