const { chromium } = require('playwright');

const executablePath = process.env.PW_CHROME ||
  'C:\\Users\\PREMIUM\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';

async function run() {
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = {};

  try {
    // Test 1: Page loads
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto('file:///D:/Work/Task-Aanyor/demo/index.html');
      await page.waitForLoadState('networkidle');

      const toggle = page.locator('#toggle');
      const visible = await toggle.isVisible();
      const text = await toggle.textContent();
      const disabled = await toggle.isDisabled();

      results.test1_button = { visible, text, disabled };
      console.log('Test 1 - Button:', JSON.stringify(results.test1_button));
      await page.close();
    }

    // Test 2: API availability
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto('file:///D:/Work/Task-Aanyor/demo/index.html');
      await page.waitForLoadState('networkidle');

      const apiCheck = await page.evaluate(() => {
        return {
          isSecureContext: window.isSecureContext,
          hasUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
          hasCanvas2D: !!document.createElement('canvas').getContext('2d'),
        };
      });
      results.test2_apis = apiCheck;
      console.log('Test 2 - APIs:', JSON.stringify(apiCheck));
      await page.close();
    }

    // Test 3: Click Start Scanning
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto('file:///D:/Work/Task-Aanyor/demo/index.html');
      await page.waitForLoadState('networkidle');

      page.on('console', (msg) => {
        console.log(`[CONSOLE ${msg.type()}]`, msg.text());
      });
      page.on('pageerror', (error) => {
        console.log('[PAGE ERROR]', error.message);
      });

      await page.locator('#toggle').click();
      await page.waitForTimeout(3000);

      const state = await page.evaluate(() => {
        const btn = document.getElementById('toggle');
        const status = document.getElementById('status');
        const video = document.getElementById('preview');
        return {
          buttonText: btn?.textContent,
          buttonDisabled: btn?.disabled,
          statusHidden: status?.hidden,
          statusText: status?.textContent,
          videoSrcObject: video?.srcObject ? 'stream-set' : 'no-stream',
          videoReadyState: video?.readyState,
        };
      });
      results.test3_click = state;
      console.log('Test 3 - Click:', JSON.stringify(state));
      await page.close();
    }

    // Test 4: Permission
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto('file:///D:/Work/Task-Aanyor/demo/index.html');
      await page.waitForLoadState('networkidle');

      const perm = await page.evaluate(async () => {
        try {
          const status = await navigator.permissions.query({ name: 'camera' });
          return { state: status.state };
        } catch (e) {
          return { error: e.message };
        }
      });
      results.test4_permission = perm;
      console.log('Test 4 - Permission:', JSON.stringify(perm));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('\n=== ALL RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
