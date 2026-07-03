const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.exit(0);

const root = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
try {
  for (const dir of fs.readdirSync(root)) {
    const helper = path.join(root, dir, 'spawn-helper');
    try {
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
    } catch {
      // Best effort: node-pty will report the real spawn error at runtime.
    }
  }
} catch {
  // node-pty may not be installed yet when npm runs lifecycle scripts in unusual orders.
}
