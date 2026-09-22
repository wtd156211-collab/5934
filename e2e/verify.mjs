// End-to-end verification of the trace waterfall UI against the live
// server (express API on :4100, vite preview on :5100).
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5100';
let failures = 0;

function check(name, condition) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

// 1. Trace list loads from the real API.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="trace-list"]');
const rows = await page.locator('.trace-table tbody tr').count();
check('trace list shows 4 traces from API', rows === 4);

// 2. Open the serial/nested checkout trace.
await page.click('[data-testid="trace-row-trace-checkout-001"]');
await page.waitForSelector('[data-testid="waterfall-svg"]');
const checkoutBars = await page.locator('#root [data-testid^="span-bar-"]').count();
check('checkout trace renders 7 span bars', checkoutBars === 7);

// 3. Collapse / expand interaction.
const firstToggle = page.locator('[data-testid^="toggle-"]').first();
await firstToggle.click();
const collapsedBars = await page.locator('[data-testid^="span-bar-"]').count();
check('collapsing a parent hides descendant bars', collapsedBars < 7);
await page.click('[data-testid="expand-all"]');
const expandedBars = await page.locator('[data-testid^="span-bar-"]').count();
check('expand-all restores all bars', expandedBars === 7);
await page.click('[data-testid="collapse-all"]');
const allCollapsed = await page.locator('[data-testid^="span-bar-"]').count();
check('collapse-all leaves only root rows', allCollapsed === 1);
await page.click('[data-testid="expand-all"]');

// 4. Zoom controls change the visible time window (axis labels change).
const axisText = () => page.locator('.timeline-axis').innerText();
const before = await axisText();
await page.click('[data-testid="zoom-in"]');
const afterIn = await axisText();
check('zoom-in changes the time axis', before !== afterIn);
await page.click('[data-testid="zoom-reset"]');
const afterReset = await axisText();
check('reset restores the original axis', afterReset === before);

// 5. Error trace: error highlight + error detail panel.
await page.click('text=← Back to trace list');
await page.waitForSelector('[data-testid="trace-list"]');
await page.click('[data-testid="trace-row-trace-error-003"]');
await page.waitForSelector('[data-testid="waterfall-svg"]');
const errorBars = await page.locator('.span-bar.error').count();
check('error trace highlights 2 error spans', errorBars === 2);
const timeoutBars = await page.locator('.span-bar.timeout').count();
check('timeout span gets timeout styling', timeoutBars === 1);
await page.locator('.span-bar.error').first().click();
await page.waitForSelector('[data-testid="span-detail"]');
const errorMsg = await page.locator('[data-testid="span-error-message"]').innerText();
check('error detail shows error message', /timeout/i.test(errorMsg));
await page.click('.detail-header button');

// 6. Broken trace: anomalies degrade gracefully without crashing.
await page.click('text=← Back to trace list');
await page.waitForSelector('[data-testid="trace-list"]');
await page.click('[data-testid="trace-row-trace-broken-004"]');
await page.waitForSelector('[data-testid="waterfall-svg"]');
const banner = await page.locator('[data-testid="anomaly-banner"]').innerText();
check('broken trace shows anomaly banner', /MISSING|missing parent/i.test(banner) && /invalid time range/i.test(banner));
const brokenBars = await page.locator('[data-testid^="span-bar-"]').count();
check('broken trace still renders all 4 spans', brokenBars === 4);
const clampedBars = await page.locator('.span-bar.clamped').count();
check('invalid-time span gets clamped styling', clampedBars === 1);

// 7. Parallel trace sanity check.
await page.click('text=← Back to trace list');
await page.waitForSelector('[data-testid="trace-list"]');
await page.click('[data-testid="trace-row-trace-parallel-002"]');
await page.waitForSelector('[data-testid="waterfall-svg"]');
const parallelBars = await page.locator('[data-testid^="span-bar-"]').count();
check('parallel trace renders 5 span bars', parallelBars === 5);

await browser.close();
console.log(failures === 0 ? '\nAll e2e checks passed.' : `\n${failures} e2e check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
