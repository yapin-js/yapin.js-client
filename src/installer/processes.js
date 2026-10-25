import { execFile, spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 15_000 }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
}

/** One row of `tasklist /FO CSV`: comma-separated, double-quoted fields. */
function parseCsvRow(line) {
  return [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
}

/**
 * PIDs of every running process with this executable name, as numbers, excluding `excludePid` (the
 * installer's own process, when it's running as the target app's own Node — see closeApp). null if
 * that can't be told.
 */
async function matchingPids(processName, platform, excludePid) {
  if (!processName) return [];
  if (platform === 'win32') {
    const out = await run('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'CSV', '/NH']);
    if (out === null) return null;
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseCsvRow)
      .filter(([name]) => name?.toLowerCase() === processName.toLowerCase())
      .map(([, pid]) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid !== excludePid);
  }
  const pgrep = await run('pgrep', ['-x', processName]);
  const pids =
    pgrep !== null
      ? pgrep
          .split('\n')
          .map((s) => Number(s.trim()))
          .filter(Number.isInteger)
      : await (async () => {
          const ps = await run('ps', ['-A', '-o', 'pid=,comm=']);
          if (ps === null) return null;
          return ps
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const match = /^(\d+)\s+(.*)$/.exec(line);
              return match ? [Number(match[1]), match[2].split('/').pop()] : null;
            })
            .filter((row) => row && row[1] === processName)
            .map(([pid]) => pid);
        })();
  return pids === null ? null : pids.filter((pid) => pid !== excludePid);
}

/**
 * Whether a process with this executable name is running, other than `excludePid` (default: this
 * process). That exclusion matters when the installer itself runs as the target app's own runtime
 * (ELECTRON_RUN_AS_NODE), which makes the installer's own process share the app's executable name.
 * null if that can't be told.
 */
export async function isRunning(processName, platform = process.platform, { excludePid = process.pid } = {}) {
  const pids = await matchingPids(processName, platform, excludePid);
  return pids === null ? null : pids.length > 0;
}

/**
 * Closes every process with this executable name except `excludePid` (default: this process). Asks
 * nicely first (by PID, never a blanket kill-by-name), then insists after `wait` ms.
 */
export async function closeApp(processName, { platform = process.platform, wait = 5000, excludePid = process.pid } = {}) {
  const killEach = async (force) => {
    const pids = await matchingPids(processName, platform, excludePid);
    for (const pid of pids ?? []) {
      if (platform === 'win32') await run('taskkill', force ? ['/F', '/PID', String(pid)] : ['/PID', String(pid)]);
      else {
        try {
          process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          // already gone
        }
      }
    }
  };
  await killEach(false);
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    if (!(await isRunning(processName, platform, { excludePid }))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  await killEach(true);
  await new Promise((r) => setTimeout(r, 500));
  return !(await isRunning(processName, platform, { excludePid }));
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
