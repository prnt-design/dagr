/**
 * Starts the Windows side's Google Chrome from WSL2 and relays its DevTools
 * port into WSL, so `frame-profile.mjs` and `backend-probe.mjs` can attach to
 * it with `DAGR_CDP` and measure the machine's GPU. Inside WSL2 the only
 * WebGPU adapter is SwiftShader; see the README.
 *
 * ```
 * node bench/browser/windows-chrome.mjs [--headless]   # leave running
 * DAGR_CDP=http://127.0.0.1:9445 node bench/browser/backend-probe.mjs --parity
 * ```
 *
 * Chrome binds its DevTools port to Windows loopback, which WSL2 in NAT mode
 * cannot reach, while Windows can reach a port WSL listens on. So a Node
 * process on the Windows side dials into this one, and each dial is joined to
 * Chrome once a client here has written to it. The benches cannot run on the
 * Windows side's Node instead: it cannot follow pnpm's symlinks over
 * `\\wsl.localhost`. Ctrl-C closes Chrome, which ends the dialer.
 *
 * `DAGR_WINDOWS_CHROME` and `DAGR_WINDOWS_NODE` override the two executables'
 * default install paths, and `DAGR_CHROMIUM_ARGS` adds launch flags.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const DEPS = process.env.DAGR_BROWSER_DEPS ?? fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(DEPS, 'package.json'));
const { chromium } = require('playwright-core');

const CHROME = process.env.DAGR_WINDOWS_CHROME ?? '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const NODE = process.env.DAGR_WINDOWS_NODE ?? '/mnt/c/Program Files/nodejs/node.exe';
const EXTRA_ARGS = (process.env.DAGR_CHROMIUM_ARGS ?? '').split(' ').filter(Boolean);
const PROFILE = 'C:\\Windows\\Temp\\dagr-bench-chrome';
const CHROME_PORT = 9333;
const DIAL_PORT = 9444;
const CDP_PORT = 9445;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const headless = process.argv.includes('--headless');

// Run by the Windows side's Node through `-e`, so it is one line with no
// double quotes, which the interop's command line would have to escape. A dial
// that ends unused is retried while Chrome is up, because WSL forwards a newly
// listening port to Windows only after a delay; once Chrome has been up and is
// gone, or has not come up in 30 seconds, the dialer exits. The socket pauses
// before it is piped: a chunk arriving while Chrome's side connects would
// otherwise be emitted with nothing listening.
const DIALER = `
  const net = require('node:net');
  const [dialPort, chromePort] = process.argv.slice(1).map(Number);
  let chromeSeen = false;
  let unseenChecks = 0;
  const dial = () => {
    const up = net.connect(dialPort, '127.0.0.1');
    let used = false;
    up.on('error', () => {});
    up.on('close', () => {
      if (used) return;
      const check = net.connect(chromePort, '127.0.0.1', () => { chromeSeen = true; check.destroy(); setTimeout(dial, 500); });
      check.on('error', () => { if (chromeSeen || ++unseenChecks > 60) process.exit(); else setTimeout(dial, 500); });
    });
    up.once('data', (first) => {
      used = true;
      up.pause();
      dial();
      const down = net.connect(chromePort, '127.0.0.1', () => { down.write(first); up.pipe(down); down.pipe(up); });
      down.on('error', () => up.destroy());
      up.on('close', () => down.destroy());
      down.on('close', () => up.destroy());
    });
  };
  dial();
  dial();
`.replace(/\s*\n\s*/g, ' ');

const spares = [];
const waiting = [];
const joinSockets = (a, b) => {
  a.pipe(b);
  b.pipe(a);
  a.on('close', () => b.destroy());
  b.on('close', () => a.destroy());
};
const dials = createServer((socket) => {
  socket.on('error', () => {});
  socket.on('close', () => {
    const at = spares.indexOf(socket);
    if (at >= 0) spares.splice(at, 1);
  });
  const client = waiting.shift();
  if (client === undefined) spares.push(socket);
  else joinSockets(client, socket);
});
const clients = createServer((socket) => {
  socket.on('error', () => {});
  const dial = spares.shift();
  if (dial === undefined) waiting.push(socket);
  else joinSockets(socket, dial);
});
dials.listen(DIAL_PORT, '127.0.0.1');
clients.listen(CDP_PORT, '127.0.0.1');

// The timing and colour switches Playwright passes to a Chrome it launches, so
// an attached run is not throttled or colour-managed where a launched one is not.
const chromeArgs = [
  `--remote-debugging-port=${CHROME_PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--force-color-profile=srgb',
  ...(headless ? ['--headless=new'] : []),
  ...EXTRA_ARGS,
  'about:blank',
];
spawn(CHROME, chromeArgs, { stdio: 'ignore' }).on('error', (error) => {
  console.error(`could not start ${CHROME}: ${error.message}`);
  process.exit(1);
});
spawn(NODE, ['-e', DIALER, String(DIAL_PORT), String(CHROME_PORT)], { stdio: 'inherit' }).on('error', (error) => {
  console.error(`could not start ${NODE}: ${error.message}`);
  process.exit(1);
});

let browser;
for (let attempt = 0; browser === undefined; attempt++) {
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 2_000 });
  } catch (error) {
    if (attempt === 15) {
      console.error(`no DevTools endpoint at ${CDP} after ${attempt} attempts: ${error.message}`);
      process.exit(1);
    }
    await delay(1_000);
  }
}
console.log(
  JSON.stringify({ attach: `DAGR_CDP=${CDP}`, browserVersion: browser.version(), mode: headless ? 'headless' : 'headed', args: chromeArgs }, null, 1),
);

process.once('SIGINT', async () => {
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.close').catch(() => {});
  dials.close();
  clients.close();
  process.exit();
});
