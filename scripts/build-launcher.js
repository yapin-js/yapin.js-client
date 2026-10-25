/**
 * Rebuilds src/installer/windows/launcher.exe, the generic setup launcher used when a client app is
 * built somewhere without csc.exe (macOS, Linux). Run on Windows after changing launcher.cs:
 *
 *   npm run build:launcher
 */
import { compileLauncher, PREBUILT_LAUNCHER } from '../src/build/windows.js';
import { version } from '../src/shared/constants.js';

compileLauncher({ out: PREBUILT_LAUNCHER, name: 'Yapin’ client', version, description: 'Installs a yapin.js-client app into the Yapin’ desktop app', company: 'yapin.js-client' });
console.log(`Built ${PREBUILT_LAUNCHER}`);
