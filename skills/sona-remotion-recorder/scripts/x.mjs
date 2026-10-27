// Driver. Usage: node x.mjs <name> '<async js using page and h>' [scopeSelector]
// Runs the code against the long-lived headless Chrome on :9333 (browser.sh),
// then saves shots/<name>.png and prints the visible controls (inside
// scopeSelector if given; pass '#none' to skip the listing).
// Use it both to explore (read the screenshot, then decide the next step) and
// to perform recorded steps (h.click / h.move / h.pause / h.mark).
import {chromium} from 'playwright';
import fs from 'fs';

const [name, code = '', scope = 'body'] = process.argv.slice(2);
const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
fs.mkdirSync('shots', {recursive: true});
const browser = await chromium.connectOverCDP('http://localhost:9333');
const ctx = browser.contexts()[0];
if (!(await ctx.cookies()).some((c) => c.name === '_backend_key')) {
  await ctx.addCookies(JSON.parse(fs.readFileSync('auth.json', 'utf8')).cookies);
}
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.setViewportSize({width: 1920, height: 1080});
page.setDefaultTimeout(20000);

// A visible cursor with a click ripple, so recordings show where clicks land.
const CURSOR_JS = `(() => {
  if (document.getElementById('__demo_cursor')) return;
  const saved = JSON.parse(sessionStorage.getItem('__cursorPos') || '{"x":960,"y":540}');
  const c = document.createElement('div');
  c.id = '__demo_cursor';
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.3 22.5 L15.2 21.2 L12 14.4 L18.5 14.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, {position: 'fixed', left: saved.x + 'px', top: saved.y + 'px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-5px,-3px)'});
  const r = document.createElement('div');
  r.id = '__demo_ring';
  Object.assign(r.style, {position: 'fixed', width: '40px', height: '40px', border: '3px solid #0d9488', borderRadius: '50%', zIndex: 2147483646, pointerEvents: 'none', opacity: '0'});
  document.documentElement.append(c, r);
  addEventListener('mousemove', (e) => {
    sessionStorage.setItem('__cursorPos', JSON.stringify({x: e.clientX, y: e.clientY}));
    c.style.left = e.clientX + 'px';
    c.style.top = e.clientY + 'px';
  }, true);
  addEventListener('mousedown', (e) => {
    r.style.transition = 'none';
    Object.assign(r.style, {left: e.clientX + 'px', top: e.clientY + 'px', opacity: '1', transform: 'translate(-50%,-50%) scale(0.4)'});
    requestAnimationFrame(() => requestAnimationFrame(() => {
      r.style.transition = 'all 450ms ease-out';
      Object.assign(r.style, {opacity: '0', transform: 'translate(-50%,-50%) scale(1.5)'});
    }));
  }, true);
})()`;

const cursorPos = async () =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('__cursorPos') || '{"x":960,"y":540}')).catch(() => ({x: 960, y: 540}));

// Helpers for recorded runs: smooth moves, clicks on locators or points, pauses.
const h = {
  cursor: async () => page.evaluate(CURSOR_JS).catch(() => {}),
  pause: (ms) => page.waitForTimeout(ms),
  mark: (label) => fs.appendFileSync('markers.jsonl', JSON.stringify({label, t: Date.now() / 1000}) + '\n'),
  move: async (x, y, ms = 550) => {
    await h.cursor();
    const from = await cursorPos();
    await page.mouse.move(from.x, from.y);
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await page.waitForTimeout(16);
    }
  },
  click: async (target, opts = {}) => {
    let x, y;
    if (typeof target.x === 'number') ({x, y} = target);
    else {
      await target.scrollIntoViewIfNeeded().catch(() => {});
      const b = await target.boundingBox();
      if (!b) throw new Error('target has no bounding box');
      x = b.x + b.width / 2 + (opts.dx ?? 0);
      y = b.y + b.height / 2 + (opts.dy ?? 0);
    }
    await h.move(x, y, opts.ms ?? 550);
    await page.waitForTimeout(opts.before ?? 250);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(opts.after ?? 600);
  },
  // Full navigation. waitGone: text that must disappear (e.g. 'Loading roster').
  go: async (path, {waitGone} = {}) => {
    await page.goto(path.startsWith('http') ? path : BASE + path);
    if (waitGone) {
      await page.waitForFunction((t) => !document.body.innerText.includes(t), waitGone, {timeout: 60000});
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    await h.cursor();
  },
  // Sona roster week containing `date` (YYYY-MM-DD).
  roster: async (orgId, date) => h.go(`/orgs/${orgId}/roster?date=${date}&period_type=weekly`, {waitGone: 'Loading roster'}),
};

const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
try {
  await h.cursor();
  await new AsyncFn('page', 'h', code)(page, h);
  await h.cursor();
} catch (e) {
  console.log('ERROR:', e.message.split('\n')[0]);
  // Still take the screenshot and list the controls below, but fail the run so
  // a broken step can't pass for a recorded one.
  process.exitCode = 1;
}
await page.waitForTimeout(1200);
await page.screenshot({path: `shots/${name}.png`});
console.log('URL:', page.url());
const items = await page.$$eval(
  `${scope} a, ${scope} button, ${scope} [phx-click], ${scope} input, ${scope} select, ${scope} textarea, ${scope} label`,
  (els) =>
    els
      .filter((e) => e.offsetParent !== null || e.type === 'checkbox')
      .map((e) => {
        const t = (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        const attrs = ['id', 'name', 'type', 'phx-click', 'for'].map((a) => (e.getAttribute(a) ? `${a}=${e.getAttribute(a).slice(0, 40)}` : '')).filter(Boolean).join(' ');
        return `${e.tagName} "${t}" ${attrs}${e.type === 'checkbox' ? ` checked=${e.checked}` : ''}`;
      })
);
console.log([...new Set(items)].slice(0, 120).join('\n'));
await browser.close();
