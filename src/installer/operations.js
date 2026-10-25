import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findInstalls, install, InstallError, repair, uninstall } from './patch.js';
import { closeApp, isRunning, launchApp } from './processes.js';
import { dataDir, defaultTarget } from './paths.js';
import { deepMerge } from '../runtime/util.js';

/**
 * What both installer front ends (the web page and the terminal) do, in one place: find installs,
 * check what state they're in, and install, repair or uninstall with the app closed.
 */
export function createOperations({ config, payload, platform = process.platform, env = process.env, extraLocations = [] }) {
  const target = deepMerge(structuredClone(defaultTarget), config.target ?? {});
  const manifest = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8'));
  const processName = target.processName?.[platform];

  const installs = () => findInstalls({ target, platform, env, extra: extraLocations });

  const describe = (found, index) => {
    const { status } = found;
    const ours = status.marker?.id === manifest.id;
    return {
      index,
      location: found.location,
      resources: found.resources,
      state: status.state,
      reason: status.reason ?? null,
      appVersion: status.version ?? null,
      installed: status.state === 'installed' ? { id: status.marker.id, name: status.marker.name, version: status.marker.version, ours } : null,
      canInstall: found.fuseCheck.ok && (status.state === 'clean' || status.state === 'needs-repair' || (status.state === 'installed' && ours)),
      blocked: found.fuseCheck.ok ? (status.state === 'foreign' ? status.reason : status.state === 'installed' && !ours ? `${status.marker.name ?? status.marker.id} is installed` : null) : found.fuseCheck.reason,
      executable: found.executable,
    };
  };

  const pick = (index) => {
    const list = installs();
    if (!list.length) throw new InstallError(`Couldn't find the ${target.productName} desktop app on this computer`, { code: 'NOT_FOUND', hint: 'Install it from https://www.yapin.gg, open it once, then run this installer again.' });
    const found = list[Number(index ?? 0)];
    if (!found) throw new InstallError('That install is gone; refresh and try again', { code: 'NOT_FOUND' });
    if (!found.fuseCheck.ok) throw new InstallError(found.fuseCheck.reason, { code: 'FUSES' });
    return found;
  };

  const ensureClosed = async (allowClose, onStep) => {
    if (!processName || !(await isRunning(processName, platform))) return;
    if (!allowClose) throw new InstallError(`${target.productName} is running`, { code: 'RUNNING', hint: `Close ${target.productName} (check the system tray too), or let the installer close it.` });
    onStep(`Closing ${target.productName}`);
    if (!(await closeApp(processName, { platform }))) throw new InstallError(`Couldn't close ${target.productName}`, { code: 'RUNNING', hint: 'Close it yourself, then try again.' });
  };

  /** Runs one action, collecting its steps (and passing each to `onStep` as it happens). */
  const run = async (fn, onStep = () => {}) => {
    const steps = [];
    try {
      const result = await fn((step) => {
        steps.push(step);
        onStep(step);
      });
      return { ok: true, steps, result };
    } catch (error) {
      return { ok: false, steps, error: error.message, code: error.code ?? 'FAILED', hint: error.hint ?? null };
    }
  };

  return {
    manifest,
    target,

    async status() {
      return {
        app: { id: manifest.id, name: manifest.name, version: manifest.version },
        running: processName ? await isRunning(processName, platform) : null,
        installs: installs().map(describe),
        dataDir: dataDir(manifest.id, { platform, env }),
        hasData: existsSync(dataDir(manifest.id, { platform, env })),
      };
    },

    install({ index, close = false, launch = false, onStep } = {}) {
      return run(async (step) => {
        const found = pick(index);
        await ensureClosed(close, step);
        const result = install({ resources: found.resources, payload, target, onStep: step });
        if (launch && found.executable) launchApp(found.executable, { platform });
        return result;
      }, onStep);
    },

    repair({ index, close = false, launch = false, onStep } = {}) {
      return run(async (step) => {
        const found = pick(index);
        await ensureClosed(close, step);
        const result = repair({ resources: found.resources, payload, target, id: manifest.id, onStep: step });
        if (launch && found.executable) launchApp(found.executable, { platform });
        return result;
      }, onStep);
    },

    uninstall({ index, purge = false, close = false, launch = false, onStep } = {}) {
      return run(async (step) => {
        const found = pick(index);
        await ensureClosed(close, step);
        const result = uninstall({ resources: found.resources, target, id: manifest.id, purge, onStep: step });
        if (launch && found.executable) launchApp(found.executable, { platform });
        return result;
      }, onStep);
    },

    launch({ index } = {}) {
      return run(async () => {
        const found = pick(index);
        if (!found.executable) throw new InstallError(`Couldn't find ${target.productName}'s program file`);
        launchApp(found.executable, { platform });
        return true;
      });
    },
  };
}
