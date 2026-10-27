// Background screen recorder for the long-lived Chrome on :9333. Usage: node rec.mjs <run>
// Captures CDP screencast frames of the first page into frames/<run>/ with
// timestamps, until it receives SIGTERM or SIGINT. It writes its PID to
// .rec-<run>.pid, so the caller stops this recorder and not another demo's.
import {chromium} from 'playwright';
import fs from 'fs';

const run = process.argv[2] ?? 'run';
const dir = `frames/${run}`;
const pidFile = `.rec-${run}.pid`;
fs.mkdirSync(dir, {recursive: true});
fs.writeFileSync(pidFile, `${process.pid}\n`);
const browser = await chromium.connectOverCDP('http://localhost:9333');
const page = browser.contexts()[0].pages()[0];
const cdp = await page.context().newCDPSession(page);
const index = [];
let n = 0;
cdp.on('Page.screencastFrame', async ({data, sessionId, metadata}) => {
  const file = `${String(n++).padStart(6, '0')}.jpg`;
  fs.writeFileSync(`${dir}/${file}`, Buffer.from(data, 'base64'));
  index.push({file, t: metadata.timestamp});
  await cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => {});
});
await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1});
console.log('recording', dir);
const stop = async () => {
  await cdp.send('Page.stopScreencast').catch(() => {});
  fs.writeFileSync(`${dir}/index.json`, JSON.stringify(index));
  fs.rmSync(pidFile, {force: true});
  console.log('stopped', index.length, 'frames');
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => fs.writeFileSync(`${dir}/index.json`, JSON.stringify(index)), 5000);
