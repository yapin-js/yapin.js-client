import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { defaultStrings } from '../installer/page.js';
import { fileVersion, pngToIco } from './windows.js';

/**
 * The Windows setup wizard: an NSIS (https://nsis.sourceforge.io) installer with the Modern UI pages
 * people know from other Windows installers — Welcome, License, a page to choose what to do, the
 * progress page with "Show details", and Finish with "Open Yapin’".
 *
 * NSIS shows the pages; the work is done by installer.mjs, run with the desktop app's own Node (see
 * src/installer/nsis.js for how the two talk). Building needs makensis, from the NSIS installer on
 * Windows, or `apt install nsis` / `brew install makensis` elsewhere.
 */

/** makensis: the configured path, MAKENSIS, the usual install folders, or the PATH. Null if none works. */
export function findMakensis({ configured = null, env = process.env, platform = process.platform } = {}) {
  const candidates = [];
  if (typeof configured === 'string') candidates.push(configured);
  if (env.MAKENSIS) candidates.push(env.MAKENSIS);
  if (platform === 'win32') {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles, env.ProgramW6432]) if (base) candidates.push(join(base, 'NSIS', 'makensis.exe'));
  }
  candidates.push('makensis');
  for (const candidate of candidates) {
    if (candidate !== 'makensis' && !existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ['-VERSION'], { stdio: 'pipe', windowsHide: true });
      return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/** A double-quoted NSIS string. NSIS strings are limited to 1024 characters, so long text is cut. */
export function nsisString(text, max = 1000) {
  let value = String(text ?? '');
  if (value.length > max) value = `${value.slice(0, max - 1).trimEnd()}…`;
  return `"${value.replace(/\$/g, '$$$$').replace(/"/g, '$$\\"').replace(/\t/g, '$$\\t').replace(/\r?\n/g, '$$\\r$$\\n')}"`;
}

/** An NSIS string mixing text with variables: nsisVars('Yapper ', ['$R3']) keeps $R3 a variable. */
export function nsisVars(...parts) {
  return `"${parts.map((part) => (Array.isArray(part) ? part.join('') : nsisString(part).slice(1, -1))).join('')}"`;
}

/** Marketing text without its markdown: **bold**, *italic*, `code` and [links](…) become plain words. */
export function plainText(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

/** Decodes an 8-bit, non-interlaced PNG to RGBA. Returns null for anything else. */
export function decodePng(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) return null;
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const data = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace !== 0) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  if (!channels || (header.color === 3 && !palette)) return null;
  const { width, height } = header;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(data));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r, g, b, a;
    if (header.color === 0) [r, g, b, a] = [pixels[s], pixels[s], pixels[s], 255];
    else if (header.color === 4) [r, g, b, a] = [pixels[s], pixels[s], pixels[s], pixels[s + 1]];
    else if (header.color === 2) [r, g, b, a] = [pixels[s], pixels[s + 1], pixels[s + 2], 255];
    else if (header.color === 6) [r, g, b, a] = [pixels[s], pixels[s + 1], pixels[s + 2], pixels[s + 3]];
    else {
      const index = pixels[s];
      [r, g, b] = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]];
      a = transparency && index < transparency.length ? transparency[index] : 255;
    }
    rgba.set([r, g, b, a], i * 4);
  }
  return { width, height, rgba };
}

/** A width×height RGB canvas, filled by `paint(x, y)` → [r, g, b]. */
function canvas(width, height, paint) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(paint(x, y), (y * width + x) * 3);
  return { width, height, rgb };
}

/** Draws `image` (RGBA) scaled to fit a size×size box at (left, top), averaging the pixels it covers. */
function drawImage(target, image, left, top, size) {
  const scale = Math.min(size / image.width, size / image.height);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  left += Math.floor((size - w) / 2);
  top += Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale);
      const y0 = Math.floor(y / scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
      const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.rgba[i + 3];
          r += image.rgba[i] * alpha;
          g += image.rgba[i + 1] * alpha;
          b += image.rgba[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const tx = left + x;
      const ty = top + y;
      if (!a || tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      const coverage = a / n / 255;
      const o = (ty * target.width + tx) * 3;
      target.rgb[o] = Math.round(target.rgb[o] * (1 - coverage) + (r / a) * coverage);
      target.rgb[o + 1] = Math.round(target.rgb[o + 1] * (1 - coverage) + (g / a) * coverage);
      target.rgb[o + 2] = Math.round(target.rgb[o + 2] * (1 - coverage) + (b / a) * coverage);
    }
  }
}

/** A 24-bit Windows bitmap, the format NSIS wants for its pictures. */
export function toBmp({ width, height, rgb }) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const file = Buffer.alloc(54 + stride * height);
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      file[row + x * 3] = rgb[i + 2];
      file[row + x * 3 + 1] = rgb[i + 1];
      file[row + x * 3 + 2] = rgb[i];
    }
  }
  return file;
}

function hexColor(value, fallback = [124, 92, 255]) {
  const match = /^#([0-9a-f]{3,8})$/i.exec(String(value ?? ''));
  if (!match) return fallback;
  const hex = match[1].length < 6 ? [...match[1].slice(0, 3)].map((c) => c + c).join('') : match[1].slice(0, 6);
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

/** The picture down the left of the Welcome and Finish pages (164×314): the accent colour, darkening, with the logo. */
export function sidebarBitmap({ accent, logo }) {
  const [r, g, b] = hexColor(accent);
  const image = canvas(164, 314, (x, y) => {
    const t = y / 313;
    const shade = 1 - 0.55 * t - 0.1 * (x / 163);
    return [r * shade, g * shade, b * shade].map((c) => Math.max(0, Math.min(255, Math.round(c))));
  });
  if (logo) drawImage(image, logo, 34, 36, 96);
  return toBmp(image);
}

/** The picture in the top right of the other pages (150×57): the logo on white. */
export function headerBitmap({ logo }) {
  const image = canvas(150, 57, () => [255, 255, 255]);
  if (logo) drawImage(image, logo, 150 - 44 - 8, 6, 44);
  return toBmp(image);
}

/** The logo to draw, from a PNG data URI or file. Null if there's none, or it isn't a PNG we can read. */
export function readLogo(source) {
  if (!source || typeof source !== 'string') return null;
  if (/^data:image\/png;base64,/i.test(source)) return decodePng(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64'));
  if (/\.png$/i.test(source) && existsSync(source)) return decodePng(readFileSync(source));
  return null;
}

/** Every text the wizard shows, with {name}, {version} and {product} filled in. */
export function wizardStrings(installer) {
  const strings = { ...defaultStrings, ...(installer.marketing?.strings ?? {}) };
  const vars = { name: installer.app.name, version: installer.app.version, product: installer.target?.productName ?? 'Yapper' };
  return Object.fromEntries(Object.entries(strings).map(([key, text]) => [key, String(text).replace(/\{(name|version|product)\}/g, (_, k) => vars[k])]));
}

/** The Welcome page's text: the intro, then the marketing description (or tagline), the notice, and "Click Next". */
export function welcomeText(installer, strings = wizardStrings(installer)) {
  const m = installer.marketing ?? {};
  const app = installer.app;
  let about = plainText(m.description ?? m.tagline ?? app.description ?? '').trim();
  if (about.length > 360) about = `${about.slice(0, 359).trimEnd()}…`;
  const notice = m.notice === false ? '' : plainText(m.notice ?? `${app.name} is an unofficial modification of the Yapin’ desktop app. It isn’t made, supported or endorsed by Yapin’.`);
  return [strings.setupWelcomeText, about, notice, strings.setupContinue].filter(Boolean).join('\n\n');
}

/**
 * The .nsi script. `files` holds the paths of what the build wrote for it (license, bitmaps, icon);
 * `source` is the installer folder that gets packed in.
 */
export function nsisScript({ installer, source, out, files, company = '', description = '', exeLocations = [] }) {
  const s = wizardStrings(installer);
  const q = (text) => nsisString(text);
  const app = installer.app;
  const m = installer.marketing ?? {};
  const closeApp = installer.closeApp ?? 'ask';
  const terms = m.terms?.text ? { title: m.terms.title ?? null, requireAccept: m.terms.requireAccept !== false } : null;
  const product = installer.target?.productName ?? 'Yapper';
  const ini = '$PLUGINSDIR\\status.ini';
  const result = '$PLUGINSDIR\\result.ini';

  return `; Generated by yapin.js-client: the Windows setup wizard for ${app.name.replace(/[\r\n]/g, ' ')}.
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

Name ${q(app.name)}
OutFile ${q(out)}
BrandingText ${q(`${app.name} ${app.version}`)}
VIProductVersion "${fileVersion(app.version)}"
VIAddVersionKey "ProductName" ${q(app.name)}
VIAddVersionKey "ProductVersion" ${q(app.version)}
VIAddVersionKey "FileVersion" ${q(app.version)}
VIAddVersionKey "FileDescription" ${q(description || `${app.name} Setup`)}
${company ? `VIAddVersionKey "CompanyName" ${q(company)}\nVIAddVersionKey "LegalCopyright" ${q(`© ${new Date().getFullYear()} ${company}`)}` : ''}

${files.icon ? `!define MUI_ICON ${q(files.icon)}` : ''}
!define MUI_WELCOMEFINISHPAGE_BITMAP ${q(files.sidebar)}
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP ${q(files.header)}
!define MUI_ABORTWARNING

Var Runtime
Var Electron
Var Count
Var Running
Var HasData
Var Index
Var Action
Var Purge
Var MainLabel
Var ProgressTitle
Var ProgressText
Var DoneTitle
Var DoneText
Var FinishText
Var Dialog
Var List
Var Where
Var State
Var RadioMain
Var RadioUninstall
Var PurgeBox
Var Notice

!define MUI_WELCOMEPAGE_TITLE ${q(s.setupWelcomeTitle)}
!define MUI_WELCOMEPAGE_TEXT ${q(welcomeText(installer, s))}
!insertmacro MUI_PAGE_WELCOME
${
  terms
    ? `${terms.title ? `!define MUI_PAGE_HEADER_TEXT ${q(terms.title)}\n` : ''}${
        terms.requireAccept ? `!define MUI_LICENSEPAGE_CHECKBOX\n!define MUI_LICENSEPAGE_CHECKBOX_TEXT ${q(s.accept)}` : '!define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"\n!define MUI_LICENSEPAGE_TEXT_BOTTOM " "'
      }
!insertmacro MUI_PAGE_LICENSE ${q(files.license)}`
    : ''
}
Page custom ChoosePage ChooseLeave
!define MUI_PAGE_HEADER_TEXT "$ProgressTitle"
!define MUI_PAGE_HEADER_SUBTEXT "$ProgressText"
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "$DoneTitle"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "$DoneText"
!define MUI_INSTFILESPAGE_ABORTHEADER_TEXT ${q(s.setupFailedTitle)}
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT ${q(s.setupFailedText)}
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE ${q(s.setupFinishTitle)}
!define MUI_FINISHPAGE_TEXT "$FinishText"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT ${q(s.launch)}
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
${installer.launchAfter === false ? '!define MUI_FINISHPAGE_RUN_NOTCHECKED' : ''}
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

; Runs installer.mjs with the arguments in $R9: with its output in the log when $R8 is "log". Exit code in $R0.
Function RunInstaller
  \${If} $Electron == 1
    System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")'
  \${Else}
    System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)'
  \${EndIf}
  SetOutPath "$PLUGINSDIR\\app"
  \${If} $R8 == "log"
    nsExec::ExecToLog '"$Runtime" "$PLUGINSDIR\\app\\installer.mjs" $R9'
  \${Else}
    nsExec::Exec '"$Runtime" "$PLUGINSDIR\\app\\installer.mjs" $R9'
  \${EndIf}
  Pop $R0
  System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", p 0)'
  SetOutPath "$TEMP"
FunctionEnd

; The desktop app's own Node (Electron run as Node), or node.exe.
Function FindRuntime
  StrCpy $Electron 1
${exeLocations
  .map(
    (exe) => `  ExpandEnvStrings $R0 ${q(exe)}
  \${If} \${FileExists} "$R0"
    StrCpy $Runtime $R0
    Return
  \${EndIf}`,
  )
  .join('\n')}
  StrCpy $Electron 0
  SearchPath $Runtime "node.exe"
FunctionEnd

Function GetStatus
  Delete "${ini}"
  StrCpy $R8 "quiet"
  StrCpy $R9 'status --nsis "${ini}"'
  Call RunInstaller
  ReadINIStr $Count "${ini}" status count
  \${If} $Count == ""
    MessageBox MB_ICONSTOP|MB_OK ${q(s.setupFailed)} /SD IDOK
    Quit
  \${EndIf}
  ReadINIStr $Running "${ini}" status running
  ReadINIStr $HasData "${ini}" status hasData
FunctionEnd

; What Next does for install $Index: install, repair (also reinstalling the same version), or "" when nothing can be done.
Function DefaultAction
  ReadINIStr $R0 "${ini}" "install$Index" state
  ReadINIStr $R1 "${ini}" "install$Index" installedVersion
  ReadINIStr $R2 "${ini}" "install$Index" canInstall
  ReadINIStr $R3 "${ini}" "install$Index" ours
  StrCpy $Action ""
  \${If} $R2 == 1
    StrCpy $Action "install"
    StrCpy $MainLabel ${q(s.install)}
    \${If} $R0 == "needs-repair"
      StrCpy $Action "repair"
      StrCpy $MainLabel ${q(s.repair)}
    \${ElseIf} $R0 == "installed"
      StrCpy $MainLabel ${q(s.update)}
      \${If} $R1 == ${q(app.version)}
        StrCpy $Action "repair"
        StrCpy $MainLabel ${q(s.repair)}
      \${EndIf}
    \${EndIf}
  \${EndIf}
FunctionEnd

Function .onInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\\app"
  File /r /x "*.sh" /x "*.command" ${q(`${source}${sep}*`)}
  SetOutPath "$TEMP"
  Call FindRuntime
  \${If} $Runtime == ""
    MessageBox MB_ICONSTOP|MB_OK ${q(s.notFound)} /SD IDOK
    Abort
  \${EndIf}
  Call GetStatus
  StrCpy $Index 0
  StrCpy $Purge 0
  Call DefaultAction
FunctionEnd

Function ChoosePage
  !insertmacro MUI_HEADER_TEXT ${q(s.setupChooseTitle)} ${q(s.setupChooseSubtitle)}
  nsDialogs::Create 1018
  Pop $Dialog
  \${If} $Dialog == error
    Abort
  \${EndIf}
  \${If} $Count == 0
    \${NSD_CreateLabel} 0 0 100% 40u ${q(s.notFound)}
    Pop $R0
    GetDlgItem $R0 $HWNDPARENT 1
    EnableWindow $R0 0
    nsDialogs::Show
    Return
  \${EndIf}
  \${If} $Count > 1
    \${NSD_CreateLabel} 0 0 100% 10u ${q(s.installInto)}
    Pop $R0
    \${NSD_CreateDropList} 0 11u 100% 80u ""
    Pop $List
    StrCpy $R1 0
    \${DoWhile} $R1 < $Count
      ReadINIStr $R2 "${ini}" "install$R1" location
      ReadINIStr $R3 "${ini}" "install$R1" appVersion
      \${NSD_CB_AddString} $List ${nsisVars(`${product} `, ['$R3'], '  (', ['$R2'], ')')}
      IntOp $R1 $R1 + 1
    \${Loop}
    \${NSD_CB_SetSelectionIndex} $List $Index
    \${NSD_OnChange} $List OnPickInstall
  \${Else}
    ReadINIStr $R3 "${ini}" "install0" appVersion
    \${NSD_CreateLabel} 0 0 100% 10u ${nsisVars(`${product} `, ['$R3'])}
    Pop $R0
    CreateFont $R1 "$(^Font)" "$(^FontSize)" 700
    SendMessage $R0 \${WM_SETFONT} $R1 0
    \${NSD_CreateLabel} 0 11u 100% 12u ""
    Pop $Where
  \${EndIf}
  \${NSD_CreateLabel} 0 28u 100% 10u ""
  Pop $State
  \${NSD_CreateRadioButton} 0 46u 100% 12u ""
  Pop $RadioMain
  \${NSD_OnClick} $RadioMain OnPickAction
  \${NSD_CreateRadioButton} 0 60u 100% 12u ${q(s.setupUninstall)}
  Pop $RadioUninstall
  \${NSD_OnClick} $RadioUninstall OnPickAction
  \${NSD_CreateCheckBox} 12u 74u -12u 12u ${q(s.purge)}
  Pop $PurgeBox
  \${NSD_CreateLabel} 0 96u 100% 40u ""
  Pop $Notice
  Call UpdateChoice
  nsDialogs::Show
FunctionEnd

Function OnPickInstall
  Pop $R0
  \${NSD_CB_GetSelectionIndex} $List $Index
  Call DefaultAction
  Call UpdateChoice
FunctionEnd

Function OnPickAction
  Pop $R0
  Call UpdateButtons
FunctionEnd

; Shows install $Index: where it is, what's there, and the choices that make sense.
Function UpdateChoice
  ReadINIStr $R0 "${ini}" "install$Index" state
  ReadINIStr $R1 "${ini}" "install$Index" ours
  ReadINIStr $R2 "${ini}" "install$Index" installedName
  ReadINIStr $R3 "${ini}" "install$Index" installedVersion
  ReadINIStr $R4 "${ini}" "install$Index" blocked
  ReadINIStr $R5 "${ini}" "install$Index" location
  \${If} $Count == 1
    \${NSD_SetText} $Where "$R5"
  \${EndIf}

  \${If} $R4 != ""
    \${NSD_SetText} $State ${q(s.setupBlockedState)}
  \${ElseIf} $R0 == "installed"
    \${NSD_SetText} $State ${nsisVars(`${s.setupInstalledState} `, ['$R2'], ' ', ['$R3'])}
  \${ElseIf} $R0 == "needs-repair"
    \${NSD_SetText} $State ${q(s.setupNeedsRepairState)}
  \${Else}
    \${NSD_SetText} $State ${q(s.setupNotInstalled)}
  \${EndIf}

  ; Uninstalling is offered for this client app (installed, or broken by a desktop update).
  StrCpy $R6 0
  \${If} $R0 == "needs-repair"
    StrCpy $R6 1
  \${ElseIf} $R0 == "installed"
  \${AndIf} $R1 == 1
    StrCpy $R6 1
  \${EndIf}

  \${If} $Action == ""
  \${OrIf} $R6 == 0
    ShowWindow $RadioMain \${SW_HIDE}
  \${Else}
    ShowWindow $RadioMain \${SW_SHOW}
  \${EndIf}
  \${If} $Action == "repair"
  \${AndIf} $R0 == "needs-repair"
    \${NSD_SetText} $RadioMain ${q(s.setupRepair)}
  \${ElseIf} $Action == "repair"
    \${NSD_SetText} $RadioMain ${q(s.setupReinstall)}
  \${ElseIf} $R0 == "installed"
    \${NSD_SetText} $RadioMain ${q(s.setupUpdate)}
  \${Else}
    \${NSD_SetText} $RadioMain ${q(s.setupInstall)}
  \${EndIf}
  \${If} $R6 == 1
    ShowWindow $RadioUninstall \${SW_SHOW}
  \${Else}
    ShowWindow $RadioUninstall \${SW_HIDE}
  \${EndIf}
  \${If} $R6 == 1
  \${AndIf} $HasData == 1
    ShowWindow $PurgeBox \${SW_SHOW}
  \${Else}
    ShowWindow $PurgeBox \${SW_HIDE}
  \${EndIf}
  \${If} $Action == ""
  \${AndIf} $R6 == 1
    \${NSD_Uncheck} $RadioMain
    \${NSD_Check} $RadioUninstall
  \${Else}
    \${NSD_Check} $RadioMain
    \${NSD_Uncheck} $RadioUninstall
  \${EndIf}

  \${If} $R4 != ""
    \${NSD_SetText} $Notice "$R4"
  \${ElseIf} $R0 == "needs-repair"
    \${NSD_SetText} $Notice ${q(s.needsRepair)}
  \${ElseIf} $Running == 1
    \${NSD_SetText} $Notice ${q(closeApp === 'never' ? s.setupStillRunning : s.appRunning)}
  \${Else}
    \${NSD_SetText} $Notice ""
  \${EndIf}
  Call UpdateButtons
FunctionEnd

; Next says what it will do, and the "delete my data" box only applies to uninstalling.
Function UpdateButtons
  GetDlgItem $R0 $HWNDPARENT 1
  \${NSD_GetState} $RadioUninstall $R1
  \${If} $R1 == \${BST_CHECKED}
    EnableWindow $PurgeBox 1
    SendMessage $R0 \${WM_SETTEXT} 0 ${q(`STR:${s.uninstall}`)}
    EnableWindow $R0 1
  \${Else}
    EnableWindow $PurgeBox 0
    \${NSD_Uncheck} $PurgeBox
    SendMessage $R0 \${WM_SETTEXT} 0 "STR:$MainLabel"
    \${If} $Action == ""
      EnableWindow $R0 0
    \${Else}
      EnableWindow $R0 1
    \${EndIf}
  \${EndIf}
FunctionEnd

Function ChooseLeave
  \${NSD_GetState} $RadioUninstall $R0
  \${If} $R0 == \${BST_CHECKED}
    StrCpy $Action "uninstall"
    \${NSD_GetState} $PurgeBox $R1
    \${If} $R1 == \${BST_CHECKED}
      StrCpy $Purge 1
    \${Else}
      StrCpy $Purge 0
    \${EndIf}
  \${Else}
    Call DefaultAction
    StrCpy $Purge 0
  \${EndIf}
  \${If} $Action == ""
    Abort
  \${EndIf}
${
  closeApp === 'never'
    ? `  \${If} $Running == 1
    Call GetStatus
    \${If} $Running == 1
      MessageBox MB_ICONEXCLAMATION|MB_OK ${q(s.setupStillRunning)}
      Abort
    \${EndIf}
  \${EndIf}`
    : closeApp === 'ask'
      ? `  \${If} $Running == 1
    MessageBox MB_ICONQUESTION|MB_OKCANCEL ${q(s.appRunning)} IDOK +2
    Abort
  \${EndIf}`
      : ''
}
  Call SetProgressText
FunctionEnd

Function SetProgressText
  StrCpy $DoneTitle ${q(s.setupDoneTitle)}
  StrCpy $DoneText ${q(s.setupDoneText)}
  \${If} $Action == "uninstall"
    StrCpy $ProgressTitle ${q(s.setupUninstallingTitle)}
    StrCpy $ProgressText ${q(s.setupUninstallingText)}
  \${ElseIf} $Action == "repair"
    StrCpy $ProgressTitle ${q(s.setupRepairingTitle)}
    StrCpy $ProgressText ${q(s.setupRepairingText)}
  \${Else}
    StrCpy $ProgressTitle ${q(s.setupInstallingTitle)}
    StrCpy $ProgressText ${q(s.setupInstallingText)}
  \${EndIf}
FunctionEnd

Section "-${app.id}"
  \${If} $Action == ""
    DetailPrint ${q(s.setupBlockedState)}
    Abort
  \${EndIf}
  Call SetProgressText
  ReadINIStr $R7 "${ini}" "install$Index" state
  IntOp $R1 $Index + 1
  StrCpy $R9 '$Action --nsis "${result}" --index $R1${closeApp === 'never' ? '' : ' --close'}'
  \${If} $Purge == 1
    StrCpy $R9 "$R9 --purge"
  \${EndIf}
  Delete "${result}"
  StrCpy $R8 "log"
  Call RunInstaller
  ReadINIStr $R1 "${result}" result ok
  \${If} $R1 != 1
    ReadINIStr $R2 "${result}" result error
    ReadINIStr $R3 "${result}" result hint
    \${If} $R2 == ""
      StrCpy $R2 ${q(s.setupFailed)}
    \${EndIf}
    DetailPrint "$R2"
    \${If} $R3 != ""
      DetailPrint "$R3"
    \${EndIf}
    SetDetailsView show
    MessageBox MB_ICONSTOP|MB_OK "$R2$\\r$\\n$\\r$\\n$R3" /SD IDOK
    Abort
  \${EndIf}
  ReadINIStr $R4 "${result}" result previous
  \${If} $Action == "uninstall"
    StrCpy $FinishText ${q(s.uninstalled)}
  \${ElseIf} $Action == "repair"
  \${AndIf} $R7 == "needs-repair"
    StrCpy $FinishText ${q(s.repaired)}
  \${ElseIf} $R4 == "installed"
  \${AndIf} $Action == "install"
    StrCpy $FinishText ${q(s.updated)}
  \${Else}
    StrCpy $FinishText ${q(s.installed)}
  \${EndIf}
  StrCpy $R5 ${q(s.setupFinishText)}
  StrCpy $FinishText "$FinishText$\\r$\\n$\\r$\\n$R5"
SectionEnd

; Starts the desktop app from its own folder, so this installer's temporary folder can be removed.
Function LaunchApp
  ReadINIStr $R0 "${ini}" "install$Index" executable
  ReadINIStr $R1 "${ini}" "install$Index" folder
  \${If} \${FileExists} "$R0"
    SetOutPath "$R1"
    Exec '"$R0"'
    SetOutPath "$TEMP"
  \${EndIf}
FunctionEnd
`;
}

/** Text NSIS shows on the license page: UTF-16 with a byte order mark, so any language works. */
function licenseFile(installer) {
  const terms = installer.marketing.terms;
  const text = `${terms.title ? `${terms.title}\r\n\r\n` : ''}${String(terms.text).replace(/\r?\n/g, '\r\n')}`;
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/**
 * Builds the setup wizard into `out` with makensis. `installer` is installer.json's content and
 * `source` the installer folder. Pictures: `sidebar` (164×314) and `header` (150×57) .bmp files
 * replace the generated ones; `icon` is a PNG (at most 256 px) or .ico.
 */
export function buildNsisExe({ makensis, installer, source, out, icon = null, sidebar = null, header = null, company = '', description = '', exeLocations = [] }) {
  const work = mkdtempSync(join(tmpdir(), 'yc-nsis-'));
  try {
    const logo = readLogo(installer.marketing?.logo);
    const files = { sidebar: sidebar ?? join(work, 'sidebar.bmp'), header: header ?? join(work, 'header.bmp'), icon: null, license: null };
    if (!sidebar) writeFileSync(files.sidebar, sidebarBitmap({ accent: installer.marketing?.accent, logo }));
    if (!header) writeFileSync(files.header, headerBitmap({ logo }));
    if (icon) {
      files.icon = join(work, 'icon.ico');
      writeFileSync(files.icon, /\.ico$/i.test(icon) ? readFileSync(icon) : pngToIco(readFileSync(icon)));
    }
    if (installer.marketing?.terms?.text) {
      files.license = join(work, 'license.txt');
      writeFileSync(files.license, licenseFile(installer));
    }
    const script = join(work, 'setup.nsi');
    writeFileSync(script, `﻿${nsisScript({ installer, source, out, files, company, description, exeLocations })}`);
    try {
      execFileSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', script], { stdio: 'pipe', windowsHide: true });
    } catch (error) {
      throw new Error(`makensis failed: ${String(error.stdout ?? '').trim() || String(error.stderr ?? '').trim() || error.message}`);
    }
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
