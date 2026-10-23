const { packager } = require('@electron/packager');
const fs = require('node:fs');
const path = require('node:path');
const sass = require('sass');

(async () => {
  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'ui/style.css'), sass.compile(path.join(root, 'ui/styles/main.scss')).css);
  const [built] = await packager({ dir: root, name: 'DudosDesk', executableName: 'DudosDesk', platform: 'win32', arch: 'x64',
    out: path.join(root, 'release'), overwrite: true, asar: true, prune: true, icon: path.join(root, 'assets/icon.ico'), appVersion: require('../package.json').version,
    ignore: file => {
      const first = file.replace(/\\/g, '/').replace(/^\//, '').split('/')[0];
      return !!first && !['assets', 'core', 'ui', 'overlay', 'integration', 'node_modules', 'main.cjs', 'preload.cjs', 'effect-preload.cjs', 'package.json'].includes(first);
    },
    win32metadata: { CompanyName: 'FermionaPlay', FileDescription: 'Dudos Desk', ProductName: 'Dudos Desk' }
  });
  fs.copyFileSync(path.join(built, 'LICENSE'), path.join(built, 'LICENSE.electron.txt'));
  for (const name of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']) fs.copyFileSync(path.join(root, name), path.join(built, name));
  fs.cpSync(path.join(root, 'docs'), path.join(built, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(root, 'assets/icon.ico'), path.join(built, 'resources/app.ico'));
  console.log(built);
})().catch(error => { console.error(error); process.exitCode = 1; });
