// Headless login for bos VMs. Usage: node login-headless.mjs <org_id>
//
// Does what a person does in login.mjs, with no window:
//   1. Logs in to internal admin as the local account from ensure-recorder-admin.sh.
//   2. Opens /internal_admin/orgs/<org_id>/users and ticks "Order by most roles".
//   3. Opens the first user in the table and clicks "Impersonate user".
//   4. The new tab lands on the org (usually the roster). The session is checked the same
//      way login.mjs checks it, then the app's cookies go to auth.json (+ auth.ok).
// On failure it saves shots/login-<step>.png and exits 1.
//
// Credentials come from $ADMIN_ENV (default ~/.config/sona-recorder/admin.env) and are
// never printed. Run ensure-recorder-admin.sh first; it is safe to re-run.
import {chromium} from 'playwright';
import fs from 'fs';
import os from 'os';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const orgId = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(orgId ?? '')) {
  console.error('usage: node login-headless.mjs <org_id>');
  process.exit(2);
}
const orgPage = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/orgs/${orgId}/`);

const envFile = process.env.ADMIN_ENV ?? `${os.homedir()}/.config/sona-recorder/admin.env`;
const creds = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (!creds.RECORDER_EMAIL || !creds.RECORDER_PASSWORD) {
  console.error(`No RECORDER_EMAIL / RECORDER_PASSWORD in ${envFile}. Run ensure-recorder-admin.sh first.`);
  process.exit(2);
}

const browser = await chromium.launch({headless: process.env.HEADED !== '1'}); // HEADED=1 to watch it on a laptop
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
context.setDefaultTimeout(30000);
const page = await context.newPage();

let step = 'start';
const fail = async (why) => {
  fs.mkdirSync('shots', {recursive: true});
  for (const [i, p] of context.pages().entries()) {
    await p.screenshot({path: `shots/login-${step}${i ? `-tab${i}` : ''}.png`}).catch(() => {});
  }
  console.error(`Login failed at "${step}": ${why}`);
  await browser.close().catch(() => {});
  process.exit(1);
};

const verified = async (url) => {
  try {
    const res = await context.request.get(url, {maxRedirects: 5});
    return res.status() === 200 && !/log_in|internal_admin_accounts/.test(res.url());
  } catch {
    return false;
  }
};

try {
  step = 'log-in';
  await page.goto(`${BASE}/internal_admin/internal_admin_accounts/log_in`);
  await page.fill('#login_form input[name="internal_admin_account[email]"]', creds.RECORDER_EMAIL);
  await page.fill('#login_form input[name="internal_admin_account[password]"]', creds.RECORDER_PASSWORD);
  await Promise.all([page.waitForURL((u) => !/internal_admin_accounts\/log_in/.test(u.href)), page.click('#login_form button[type="submit"]')]);

  step = 'users';
  await page.goto(`${BASE}/internal_admin/orgs/${orgId}/users`);
  if (/log_in/.test(page.url())) await fail('still on the login page: wrong password? Re-run ensure-recorder-admin.sh.');
  await page.waitForSelector('#user-filters-form');

  step = 'most-roles';
  await page.getByLabel('Order by most roles').check();
  await page.waitForURL(/most_roles_first=true/);
  const firstRow = page.locator('[id^="entry-"]').first();
  await firstRow.waitFor();
  const name = (await firstRow.locator('a').first().innerText()).trim();

  step = 'user-page';
  await firstRow.locator('a').first().click();
  await page.waitForURL(new RegExp(`/internal_admin/orgs/${orgId}/user/`));

  step = 'impersonate';
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', {name: 'Impersonate user'}).click()]);
  await tab.waitForLoadState();

  step = 'verify';
  const deadline = Date.now() + 30000;
  let url = null;
  while (!url && Date.now() < deadline) {
    const onOrg = context.pages().find((p) => orgPage.test(p.url()));
    if (onOrg && (await verified(onOrg.url()))) url = onOrg.url();
    else await new Promise((r) => setTimeout(r, 1000));
  }
  if (!url) await fail(`no tab reached a verified /orgs/${orgId}/ page; the impersonation tab is on ${tab.url()}`);

  // The cookies are a live impersonated session: readable by the owner only.
  fs.writeFileSync('auth.json', JSON.stringify({cookies: await context.cookies(BASE), origins: []}, null, 2), {mode: 0o600});
  fs.chmodSync('auth.json', 0o600);
  fs.writeFileSync('auth.ok', url + '\n');
  console.log(`Impersonating ${name}. Session verified and saved for ${url}`);
} catch (e) {
  await fail(e.message.split('\n')[0]);
}
await browser.close().catch(() => {});
