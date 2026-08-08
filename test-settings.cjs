const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { 
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => {
    errors.push('PAGEERROR: ' + err.message + '\nSTACK: ' + (err.stack || '').split('\n').slice(0,3).join(' | '));
  });
  try {
    await page.goto('http://127.0.0.1:3721/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch(e) { errors.push('NAV: ' + e.message); }
  await page.waitForTimeout(5000);
  const settingsBtn = await page.$('#settings-btn');
  const settingsOverlay = await page.$('#settings-overlay');
  console.log('settings-btn:', settingsBtn ? 'FOUND' : 'MISSING');
  console.log('settings-overlay:', settingsOverlay ? 'FOUND' : 'MISSING');
  if (settingsBtn) {
    try {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      const visible = await settingsOverlay?.isVisible();
      console.log('overlay visible after click:', visible);
    } catch(e) { console.log('CLICK ERROR:', e.message); }
  }
  console.log('JS ERRORS (' + errors.length + '):');
  errors.forEach(e => console.log(' -', e.substring(0,300)));
  await browser.close();
})().catch(e => console.error('FATAL:', e.message));
