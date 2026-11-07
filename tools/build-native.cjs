const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Compile once during packaging; users do not need a development toolchain.
function buildNative() {
  const root = path.resolve(__dirname, '..');
  const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const output = path.join(root, 'native/CaptchaInput.exe');
  if (!fs.existsSync(compiler)) throw Error('Windows .NET Framework C# compiler is required');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/out:' + output, path.join(root, 'native/CaptchaInput.cs')], { stdio: 'inherit', windowsHide: true });
  execFileSync(output, ['--self-test'], { stdio: 'inherit', windowsHide: true });
  const controls = path.join(root, 'native/ControlsInput.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/out:' + controls, path.join(root, 'native/ControlsInput.cs')], { stdio: 'inherit', windowsHide: true });
  execFileSync(controls, ['--self-test'], { stdio: 'inherit', windowsHide: true });
  return output;
}
if (require.main === module) buildNative();
module.exports = { buildNative };
