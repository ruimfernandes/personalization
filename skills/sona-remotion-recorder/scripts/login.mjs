// Manual login helper. Usage: node login.mjs [org_id]
//
// Opens a visible browser at the internal-admin login page and lets the user
// log in, impersonate a manager, and open any org page (impersonating usually
// lands on the roster). As soon as that page is a verified session, it saves
// the cookies, writes auth.ok, and closes the window itself.
//
// Verified means: some tab is on a normal org page (/orgs/<id>/..., not
// /internal_admin/...) and a request to that page with the same cookies is not
// redirected to a login page. auth.ok holds the page it verified, so the
// caller can wait on that file.
//
// Why it works this way (what went wrong before):
// - Saving when the URL "left /users/log_in" fired on an intermediate redirect
//   (/users/internal_admin) before the user was logged in.
// - Matching the org id anywhere in the URL fired on the internal-admin org
//   page (/internal_admin/orgs/<id>/users) before impersonating.
// - Watching a single tab crashed when impersonation opened or closed a tab.
// - A persistent profile doesn't help: session cookies are dropped on restart.
// - context.storageState() opens a hidden tab for every visited origin that no
//   open tab is on. In a visible browser that tab flashes and steals focus, and
//   saving every few seconds made the window flicker non-stop. x.mjs only needs
//   the app's cookies, so only the cookies for BASE are saved, once. Cookies
//   from other origins (an identity provider, say) stay out of auth.json.
import {chromium} from 'playwright';
import fs from 'fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
const orgId = process.argv[2];
const orgPage = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/orgs/${orgId ?? '[0-9a-f-]{36}'}/`);

const browser = await chromium.launch({headless: false});
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
const first = await context.newPage();
await first.goto(`${BASE}/internal_admin/`);

let closed = false;
browser.on('disconnected', () => (closed = true));

const verified = async (url) => {
  try {
    const res = await context.request.get(url, {maxRedirects: 5});
    return res.status() === 200 && !/log_in|internal_admin_accounts/.test(res.url());
  } catch {
    return false;
  }
};

let savedFor = null;
const deadline = Date.now() + 45 * 60 * 1000;
while (!closed && !savedFor && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  let pages = [];
  try {
    pages = context.pages();
  } catch {
    break;
  }
  const onOrg = pages.find((p) => orgPage.test(p.url()));
  if (!onOrg) continue;
  const url = onOrg.url();
  if (!(await verified(url))) continue;
  // The cookies are a live impersonated session: readable by the owner only.
  fs.writeFileSync('auth.json', JSON.stringify({cookies: await context.cookies(BASE), origins: []}, null, 2), {mode: 0o600});
  fs.chmodSync('auth.json', 0o600);
  fs.writeFileSync('auth.ok', url + '\n');
  console.log('Session verified and saved for', url);
  savedFor = url;
}
if (!savedFor) console.log('No verified session was saved.');
await browser.close().catch(() => {});
