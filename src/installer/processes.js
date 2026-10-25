import { execFile, spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 15_000 }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

/** Whether a process with this executable name is running. null if that can't be told. */
export async function isRunning(processName, platform = process.platform) {
  if (!processName) return null;
  if (platform === 'win32') {
    const out = await run('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'CSV', '/NH']);
    if (out === null) return null;
    return out.toLowerCase().includes(`"${processName.toLowerCase()}"`);
  }
  const out = await run('pgrep', ['-x', processName]);
  if (out === null) {
    const ps = await run('ps', ['-A', '-o', 'comm=']);
    if (ps === null) return null;
    return ps.split('\n').some((line) => line.trim().split('/').pop() === processName);
  }
  return out.trim().length > 0;
}

/** Closes every process with this executable name. Asks nicely first, then insists after `wait` ms. */
export async function closeApp(processName, { platform = process.platform, wait = 5000 } = {}) {
  if (platform === 'win32') await run('taskkill', ['/IM', processName]);
  else await run('pkill', ['-x', processName]);
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    if (!(await isRunning(processName, platform))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (platform === 'win32') await run('taskkill', ['/F', '/IM', processName]);
  else await run('pkill', ['-9', '-x', processName]);
  await new Promise((r) => setTimeout(r, 500));
  return !(await isRunning(processName, platform));
}

/** Starts the app, detached from the installer. */
export function launchApp(executable, { platform = process.platform, args = [] } = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child =
    platform === 'darwin' && executable.includes('.app/')
      ? spawn('open', ['-a', executable.slice(0, executable.indexOf('.app/') + 4), '--args', ...args], { detached: true, stdio: 'ignore', env })
      : spawn(executable, args, { detached: true, stdio: 'ignore', env });
  child.unref();
}
