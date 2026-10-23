const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { icons } = require('lucide');
const root = path.resolve(__dirname, '..');

// Render the existing icon family into Windows raster assets.
function xml(node) {
  const [tag, attrs, children = []] = node;
  return `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${children.map(xml).join('')}</${tag}>`;
}
(async () => {
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
    await page.setContent(`<style>body{margin:0}div{width:256px;height:256px;display:grid;place-items:center;background:#b73d58;border-radius:44px;color:white}svg{width:172px;height:172px;stroke-width:1.65}</style><div>${xml(icons.MonitorX)}</div>`);
    const png = await page.screenshot({ path: path.join(root, 'assets/icon.png'), omitBackground: true });
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, png]));
    fs.writeFileSync(path.join(root, 'assets/chevron.svg'), xml(icons.ChevronDown).replace('currentColor', '#789198'));
    fs.copyFileSync(path.resolve(path.dirname(require.resolve('lucide')), '../umd/lucide.js'), path.join(root, 'assets/lucide.js'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
