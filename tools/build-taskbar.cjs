const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// Build a stable Node-API addon; it has no dependency on another Desk checkout.
function buildTaskbar() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Taskbar addon requires Windows x64');
  const root = path.resolve(__dirname, '..');
  const vswhere = path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio/Installer/vswhere.exe');
  const vs = JSON.parse(execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-format', 'json'], { encoding: 'utf8', windowsHide: true }))[0];
  if (!vs) throw Error('MSVC build tools are required');
  const vc = path.join(vs.installationPath, 'VC/Tools/MSVC');
  const version = fs.readdirSync(vc).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  const sdk = process.env.WINDOWS_SDK_ROOT || path.join(process.env['ProgramFiles(x86)'], 'Windows Kits/10');
  const sdkVersion = fs.readdirSync(path.join(sdk, 'Include')).filter(v => /^10\./.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  const cache = process.env.NODE_API_HEADERS || path.join(process.env.LOCALAPPDATA, 'node-gyp/Cache/20.17.0');
  if (!fs.existsSync(path.join(cache, 'include/node/node_api.h')) || !fs.existsSync(path.join(cache, 'x64/node.lib')))
    throw Error('Set NODE_API_HEADERS to a Node.js headers directory containing include/node and x64/node.lib');
  const output = path.join(root, 'core/taskbar-native.node');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const intermediate = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-taskbar-build-'));
  const compiler = path.join(vc, version, 'bin/Hostx64/x64/cl.exe');
  const include = [path.join(vc, version, 'include'), ...['ucrt', 'shared', 'um', 'winrt'].map(v => path.join(sdk, 'Include', sdkVersion, v)), path.join(cache, 'include/node')];
  const args = ['/nologo', '/LD', '/std:c++17', '/EHsc', '/O2', '/MT', '/DNAPI_VERSION=8', ...include.map(v => '/I' + v),
    path.join(root, 'native/taskbar.cpp'), '/Fo' + path.join(intermediate, 'taskbar.obj'), '/link', '/OUT:' + output,
    '/IMPLIB:' + path.join(intermediate, 'taskbar.lib'), '/DELAYLOAD:node.exe',
    '/LIBPATH:' + path.join(vc, version, 'lib/x64'), ...['ucrt', 'um'].map(v => '/LIBPATH:' + path.join(sdk, 'Lib', sdkVersion, v, 'x64')),
    path.join(cache, 'x64/node.lib'), 'runtimeobject.lib', 'advapi32.lib', 'user32.lib', 'delayimp.lib'];
  execFileSync(compiler, args, { stdio: 'inherit', windowsHide: true });
  return output;
}
module.exports = { buildTaskbar };
if (require.main === module) console.log(buildTaskbar());
