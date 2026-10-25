/**
 * The installer's web page, built from `installer.marketing` in the client app's config. Three presets:
 * - minimal:  one card with the logo, name and buttons;
 * - default:  a hero, the feature list, then the install panel;
 * - showcase: the default plus screenshots and a changelog.
 * Every text is HTML-escaped; descriptions accept **bold**, *italic*, `code` and [links](https://…).
 */

export const defaultStrings = Object.freeze({
  install: 'Install',
  update: 'Update',
  repair: 'Repair',
  uninstall: 'Uninstall',
  working: 'Working…',
  launch: 'Open Yapin’',
  closeInstaller: 'Close installer',
  installInto: 'Install into',
  notFound: 'The Yapin’ desktop app isn’t installed on this computer. Install it from yapin.gg, open it once, then run this installer again.',
  appRunning: '{product} is open. The installer will close it to continue.',
  installed: '{name} {version} is installed.',
  updated: '{name} has been updated to {version}.',
  repaired: '{name} is back after the desktop app updated.',
  uninstalled: '{name} has been removed.',
  purge: 'Also delete my installed plugins, themes and settings',
  accept: 'I have read and accept the terms above',
  version: 'Version',
  needsRepair: 'The desktop app updated itself, so {name} needs to be put back.',
  otherInstalled: '{other} is installed here. Uninstall it first.',
  connectionLost: 'The installer has stopped. Close this tab and run it again.',
  // The Windows setup wizard
  setupWelcomeTitle: 'Welcome to {name} Setup',
  setupWelcomeText: 'Setup will install {name} {version} into the Yapin’ desktop app.',
  setupContinue: 'Click Next to continue.',
  setupChooseTitle: 'Choose an Option',
  setupChooseSubtitle: 'Choose what Setup should do with {name}.',
  setupInstall: 'Install {name} {version}',
  setupUpdate: 'Update to {name} {version}',
  setupReinstall: 'Reinstall {name} {version}',
  setupRepair: 'Repair {name}',
  setupUninstall: 'Uninstall {name}',
  setupNotInstalled: 'Not installed. Click Install to continue.',
  setupInstalledState: 'Installed:',
  setupNeedsRepairState: 'Needs repair',
  setupBlockedState: 'Can’t install here',
  setupInstallingTitle: 'Installing',
  setupInstallingText: 'Please wait while {name} is being installed.',
  setupRepairingTitle: 'Repairing',
  setupRepairingText: 'Please wait while {name} is being repaired.',
  setupUninstallingTitle: 'Uninstalling',
  setupUninstallingText: 'Please wait while {name} is being removed.',
  setupDoneTitle: 'Completed',
  setupDoneText: 'Setup finished.',
  setupFailedTitle: 'Setup Failed',
  setupFailedText: 'Nothing was changed. Click Show details for more.',
  setupFailed: 'The installer stopped with an error.',
  setupStillRunning: '{product} is still open. Close it (check the system tray too), then click Next again.',
  setupFinishTitle: 'Completing {name} Setup',
  setupFinishText: 'Click Finish to close Setup.',
});

export function escapeHTML(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Escapes, then turns a little markdown into HTML. Only https links survive. */
export function inlineMarkdown(text) {
  return escapeHTML(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s"]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br>');
}

function paragraphs(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${inlineMarkdown(p.trim())}</p>`)
    .join('');
}

function safeSrc(src) {
  const value = String(src ?? '');
  return /^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml|x-icon);base64,)/i.test(value) ? escapeHTML(value) : '';
}

function color(value, fallback) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value ?? '')) ? value : fallback;
}

function background(value) {
  const v = String(value ?? '');
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(linear|radial|conic)-gradient\([#\w\s,.%()-]+\)$/i.test(v)) return v;
  const src = safeSrc(v);
  return src ? `center / cover no-repeat url("${src}")` : null;
}

function featureIcon(icon) {
  if (!icon) return '';
  const src = safeSrc(icon);
  if (src) return `<img class="feature-icon" src="${src}" alt="">`;
  return `<span class="feature-icon emoji" aria-hidden="true">${escapeHTML(String(icon).slice(0, 4))}</span>`;
}

const CSS = `
*{box-sizing:border-box}
:root{--accent:#7c5cff;--bg:#121318;--panel:#1b1c22;--panel-2:#23242c;--text:#ececf1;--muted:#9c9daa;--border:#ffffff14;--danger:#f2555a;--success:#3fcf82;--warning:#f5b544;--radius:14px;color-scheme:dark}
:root[data-theme=light]{--bg:#f4f5f8;--panel:#fff;--panel-2:#f0f1f5;--text:#16171c;--muted:#5d5f6b;--border:#0000001a;color-scheme:light}
@media (prefers-color-scheme:light){:root[data-theme=auto]{--bg:#f4f5f8;--panel:#fff;--panel-2:#f0f1f5;--text:#16171c;--muted:#5d5f6b;--border:#0000001a;color-scheme:light}}
html,body{margin:0;min-height:100%}
body{background:var(--page-bg,var(--bg));color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
code{font:13px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--panel-2);padding:1px 5px;border-radius:5px}
.wrap{max-width:980px;margin:0 auto;padding:48px 20px 64px}
.hero{display:flex;gap:28px;align-items:center;margin-bottom:40px}
.logo{width:96px;height:96px;border-radius:22px;object-fit:cover;flex-shrink:0;box-shadow:0 12px 40px #0006}
.hero h1{font-size:40px;line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent);vertical-align:middle;margin-left:8px;letter-spacing:.02em}
.tagline{font-size:19px;color:var(--muted);margin:0}
.description{color:var(--muted);max-width:720px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:28px 0 36px}
.feature{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:18px}
.feature h3{margin:10px 0 4px;font-size:16px}
.feature p{margin:0;color:var(--muted);font-size:14px}
.feature-icon{width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
.feature-icon.emoji{font-size:24px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);padding:24px;box-shadow:0 20px 60px #0000004d}
.panel h2{margin:0 0 14px;font-size:20px}
.installs{display:flex;flex-direction:column;gap:8px;margin:0 0 16px}
.install{display:flex;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--panel-2);cursor:pointer}
.install input{accent-color:var(--accent)}
.install .where{font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);word-break:break-all}
.install .state{margin-left:auto;font-size:12px;font-weight:600;white-space:nowrap}
.state.ok{color:var(--success)}.state.warn{color:var(--warning)}.state.bad{color:var(--danger)}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:11px 20px;cursor:pointer;background:var(--accent);color:#fff;transition:filter .15s,transform .05s}
button:hover{filter:brightness(1.08)}button:active{transform:translateY(1px)}
button.ghost{background:var(--panel-2);color:var(--text);border:1px solid var(--border)}
button.danger{background:transparent;color:var(--danger);border:1px solid color-mix(in srgb,var(--danger) 45%,transparent)}
button:disabled{opacity:.5;cursor:default;filter:none}
.check{display:flex;gap:8px;align-items:flex-start;margin:12px 0;color:var(--muted);font-size:14px}
.check input{accent-color:var(--accent);margin-top:4px}
.message{margin-top:16px;padding:12px 14px;border-radius:10px;background:var(--panel-2);display:none}
.message.show{display:block}
.message.error{border-left:3px solid var(--danger)}.message.success{border-left:3px solid var(--success)}.message.info{border-left:3px solid var(--accent)}
.message .hint{color:var(--muted);font-size:14px;margin-top:4px}
.steps{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:13px}
.terms{max-height:180px;overflow:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--muted);white-space:pre-wrap}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:36px 0}
.shots figure{margin:0}.shots img{width:100%;border-radius:12px;border:1px solid var(--border);display:block}
.shots figcaption{color:var(--muted);font-size:13px;margin-top:6px}
.changelog{margin-top:36px}.changelog h3{margin:18px 0 4px}.changelog .date{color:var(--muted);font-size:13px;font-weight:400;margin-left:6px}
.changelog ul{margin:4px 0;padding-left:20px;color:var(--muted)}
.links{display:flex;gap:16px;flex-wrap:wrap;margin-top:28px}
.notice{margin-top:28px;color:var(--muted);font-size:13px}
footer{margin-top:20px;color:var(--muted);font-size:13px}
.minimal .wrap{max-width:520px;padding-top:12vh}
.minimal .hero{flex-direction:column;text-align:center;gap:14px;margin-bottom:24px}
.minimal .links{justify-content:center}.minimal .notice,.minimal footer{text-align:center}
@media (max-width:640px){.hero{flex-direction:column;text-align:center}.hero h1{font-size:32px}.wrap{padding-top:28px}}
`;

/** Script for the page. Kept as a plain function so it's real JS, then serialised into the page. */
function pageScript() {
  const data = JSON.parse(document.getElementById('installer-data').textContent);
  const strings = data.strings;
  const token = new URLSearchParams(location.hash.slice(1)).get('t') ?? '';
  history.replaceState(null, '', location.pathname);
  const $ = (id) => document.getElementById(id);
  const fill = (text, extra = {}) => String(text).replace(/\{(\w+)\}/g, (_, key) => extra[key] ?? data.vars[key] ?? '');
  let status = null;
  let busy = false;

  const api = async (path, body) => {
    const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-installer-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.json();
  };

  const message = (kind, title, hint, steps) => {
    const box = $('message');
    box.className = `message show ${kind}`;
    box.replaceChildren();
    const strong = document.createElement('div');
    strong.textContent = title;
    box.append(strong);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = hint;
      box.append(h);
    }
    if (steps?.length) {
      const list = document.createElement('ul');
      list.className = 'steps';
      for (const step of steps) {
        const li = document.createElement('li');
        li.textContent = step;
        list.append(li);
      }
      box.append(list);
    }
  };

  const selected = () => Number(document.querySelector('input[name=install]:checked')?.value ?? 0);
  const current = () => status?.installs?.[selected()] ?? null;

  const render = () => {
    const list = $('installs');
    list.replaceChildren();
    if (!status.installs.length) {
      message('error', strings.notFound);
      for (const id of ['install', 'repair', 'uninstall']) $(id).hidden = true;
      return;
    }
    status.installs.forEach((inst, i) => {
      const label = document.createElement('label');
      label.className = 'install';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'install';
      radio.value = String(i);
      radio.checked = i === 0;
      radio.addEventListener('change', update);
      const text = document.createElement('div');
      const title = document.createElement('div');
      title.textContent = `${data.vars.product}${inst.appVersion ? ` ${inst.appVersion}` : ''}`;
      const where = document.createElement('div');
      where.className = 'where';
      where.textContent = inst.location;
      text.append(title, where);
      const state = document.createElement('div');
      state.className = 'state';
      if (inst.blocked) {
        state.classList.add('bad');
        state.textContent = inst.state === 'installed' ? fill(strings.otherInstalled, { other: inst.installed?.name ?? '' }) : 'Can’t install here';
        state.title = inst.blocked;
      } else if (inst.state === 'installed') {
        state.classList.add('ok');
        state.textContent = `${inst.installed.name} ${inst.installed.version}`;
      } else if (inst.state === 'needs-repair') {
        state.classList.add('warn');
        state.textContent = 'Needs repair';
      } else {
        state.textContent = 'Not installed';
      }
      label.append(radio, text, state);
      list.append(label);
    });
    $('installs-wrap').hidden = status.installs.length < 2;
    update();
  };

  const update = () => {
    const inst = current();
    if (!inst) return;
    const ours = inst.state === 'installed' && inst.installed?.ours;
    const sameVersion = ours && inst.installed.version === data.vars.version;
    $('install').hidden = sameVersion;
    $('install').textContent = ours ? strings.update : strings.install;
    $('install').disabled = busy || !inst.canInstall || (data.terms && !$('accept')?.checked);
    $('repair').hidden = !(inst.state === 'needs-repair' || sameVersion);
    $('repair').disabled = busy || !inst.canInstall;
    $('uninstall').hidden = !(ours || inst.state === 'needs-repair');
    $('uninstall').disabled = busy;
    if (inst.blocked) message('error', inst.blocked);
    else if (inst.state === 'needs-repair') message('info', fill(strings.needsRepair));
    else if (status.running) message('info', fill(strings.appRunning));
  };

  const refresh = async () => {
    status = await api('/api/status');
    render();
  };

  const act = async (action, extra = {}) => {
    if (busy) return;
    busy = true;
    update();
    const button = $(action);
    const label = button.textContent;
    button.textContent = strings.working;
    try {
      const result = await api(`/api/${action}`, { index: selected(), close: true, launch: false, ...extra });
      if (!result.ok) {
        message('error', result.error, result.hint, result.steps);
      } else {
        const key = action === 'uninstall' ? 'uninstalled' : action === 'repair' ? 'repaired' : result.result?.previous === 'installed' ? 'updated' : 'installed';
        message('success', fill(strings[key]), null, result.steps);
        $('launch').hidden = false;
      }
    } catch (error) {
      message('error', error.message);
    } finally {
      button.textContent = label;
      busy = false;
      await refresh().catch(() => {});
    }
  };

  $('install').addEventListener('click', () => act('install'));
  $('repair').addEventListener('click', () => act('repair'));
  $('uninstall').addEventListener('click', () => {
    const purge = status.hasData && confirm(strings.purge);
    act('uninstall', { purge });
  });
  $('launch').addEventListener('click', async () => {
    await api('/api/launch', { index: selected() }).catch(() => {});
  });
  $('quit').addEventListener('click', async () => {
    await api('/api/quit', {}).catch(() => {});
    window.close();
    message('info', strings.connectionLost);
  });
  $('accept')?.addEventListener('change', update);
  setInterval(() => api('/api/ping', {}).catch(() => message('error', strings.connectionLost)), 5000);
  refresh().catch((error) => message('error', error.message));
}

/** The full page. `nonce` goes on the script tag and in the Content-Security-Policy header. */
export function renderPage(installer, { nonce }) {
  const m = installer.marketing ?? {};
  const app = installer.app;
  const preset = installer.preset ?? 'default';
  const strings = { ...defaultStrings, ...(m.strings ?? {}) };
  const product = installer.target?.productName ?? 'Yapper';
  const title = m.title ?? app.name;
  const accent = color(m.accent, '#7c5cff');
  const bg = background(m.background);
  const notice = m.notice === false ? '' : m.notice ?? `${app.name} is an unofficial modification of the Yapin’ desktop app. It isn’t made, supported or endorsed by Yapin’.`;
  const links = [...(m.links ?? []), ...(m.links ? [] : Object.entries(app.links ?? {}).map(([label, url]) => ({ label: label[0].toUpperCase() + label.slice(1), url })))].filter((l) => /^https:\/\//.test(l.url ?? ''));
  const data = {
    strings,
    vars: { name: app.name, version: app.version, product },
    terms: Boolean(m.terms?.requireAccept !== false && m.terms?.text),
  };
  const features = preset === 'minimal' ? [] : m.features ?? [];
  const shots = preset === 'showcase' ? m.screenshots ?? [] : [];
  const changelog = preset === 'showcase' ? m.changelog ?? [] : [];
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${escapeHTML(m.lang ?? 'en')}" data-theme="${escapeHTML(['dark', 'light', 'auto'].includes(m.theme) ? m.theme : 'dark')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(m.pageTitle ?? `Install ${app.name}`)}</title>
${m.icon || m.logo ? `<link rel="icon" href="${safeSrc(m.icon ?? m.logo)}">` : ''}
<style>${CSS}:root{--accent:${accent}}${bg ? `body{--page-bg:${bg};background:${bg};background-attachment:fixed}` : ''}</style>
${m.css ? `<style>${String(m.css).replace(/<\/style/gi, '')}</style>` : ''}
</head>
<body class="${escapeHTML(preset)}">
<main class="wrap">
  <header class="hero">
    ${m.logo ? `<img class="logo" src="${safeSrc(m.logo)}" alt="">` : ''}
    <div>
      <h1>${escapeHTML(title)}${m.badge ? `<span class="tag">${escapeHTML(m.badge)}</span>` : ''}</h1>
      ${m.tagline ? `<p class="tagline">${inlineMarkdown(m.tagline)}</p>` : ''}
      ${preset !== 'minimal' && (m.description ?? app.description) ? `<div class="description">${paragraphs(m.description ?? app.description)}</div>` : ''}
    </div>
  </header>
  ${features.length ? `<section class="grid">${features.map((f) => `<div class="feature">${featureIcon(f.icon)}<h3>${escapeHTML(f.title)}</h3>${f.text ? `<p>${inlineMarkdown(f.text)}</p>` : ''}</div>`).join('')}</section>` : ''}
  <section class="panel">
    <h2>${escapeHTML(m.panelTitle ?? `${app.name} ${app.version}`)}</h2>
    <div id="installs-wrap" hidden><div class="check">${escapeHTML(strings.installInto)}</div></div>
    <div id="installs" class="installs"></div>
    ${data.terms ? `<div class="terms">${escapeHTML(m.terms.title ? `${m.terms.title}\n\n` : '')}${escapeHTML(m.terms.text)}</div><label class="check"><input type="checkbox" id="accept"> ${escapeHTML(strings.accept)}</label>` : ''}
    <div class="actions">
      <button id="install" type="button">${escapeHTML(strings.install)}</button>
      <button id="repair" type="button" class="ghost" hidden>${escapeHTML(strings.repair)}</button>
      <button id="uninstall" type="button" class="danger" hidden>${escapeHTML(strings.uninstall)}</button>
      <button id="launch" type="button" class="ghost" hidden>${escapeHTML(strings.launch)}</button>
      <button id="quit" type="button" class="ghost">${escapeHTML(strings.closeInstaller)}</button>
    </div>
    <div id="message" class="message" role="status" aria-live="polite"></div>
  </section>
  ${shots.length ? `<section class="shots">${shots.map((s) => `<figure><img src="${safeSrc(s.src)}" alt="${escapeHTML(s.caption ?? '')}" loading="lazy">${s.caption ? `<figcaption>${inlineMarkdown(s.caption)}</figcaption>` : ''}</figure>`).join('')}</section>` : ''}
  ${changelog.length ? `<section class="changelog"><h2>${escapeHTML(m.changelogTitle ?? 'What’s new')}</h2>${changelog.map((c) => `<h3>${escapeHTML(c.version)}${c.date ? `<span class="date">${escapeHTML(c.date)}</span>` : ''}</h3><ul>${(c.notes ?? []).map((n) => `<li>${inlineMarkdown(n)}</li>`).join('')}</ul>`).join('')}</section>` : ''}
  ${links.length ? `<nav class="links">${links.map((l) => `<a href="${escapeHTML(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(l.label)}</a>`).join('')}</nav>` : ''}
  ${notice ? `<p class="notice">${inlineMarkdown(notice)}</p>` : ''}
  ${m.footer ? `<footer>${inlineMarkdown(m.footer)}</footer>` : ''}
</main>
<script type="application/json" id="installer-data">${json}</script>
<script nonce="${escapeHTML(nonce)}">(${pageScript.toString()})();</script>
</body>
</html>`;
}
