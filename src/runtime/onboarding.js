import { h } from './ui.js';

/**
 * The rounded-corner "Welcome" screen a client app shows the first time it runs with no saved state,
 * and the "What's new" screen it shows after an update. Both are entirely optional (`welcome: false` /
 * `whatsNew: false`), entirely editable from the config (title, icon, steps/entries, labels), and can
 * be replayed at any time with `client.welcome.show()` / `client.whatsNew.show()`.
 */
const SEEN_NAMESPACE = 'onboarding';

function fill(text, client) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{name\}/g, client.name).replace(/\{version\}/g, client.version);
}

/** Builds the shared rounded, animated panel. Returns the backdrop element; caller appends it. */
function panel(client, { icon, title, subtitle, rows = [], actionLabel, dismissLabel, dismissable = true, onAction, onDismiss, onClose }) {
  const { ui } = client;
  const doc = globalThis.document;
  let settled = false;
  const finish = (fn) => {
    if (settled) return;
    settled = true;
    backdrop.classList.add('yc-onboard-leave');
    doc.removeEventListener('keydown', onKey, true);
    setTimeout(() => backdrop.remove(), 180);
    fn?.();
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && dismissable) {
      event.stopPropagation();
      finish(onDismiss);
    }
  };
  const rowsEl = rows.map((row, index) =>
    h(
      'div',
      { class: 'yc-onboard-row', style: { '--yc-i': String(index) } },
      row.icon !== false && h('div', { class: 'yc-onboard-row-icon' }, ui.icon(row.icon ?? 'sparkles')),
      h('div', { class: 'yc-onboard-row-body' }, h('div', { class: 'yc-onboard-row-title' }, row.title), row.description && h('div', { class: 'yc-onboard-row-desc' }, row.description)),
    ),
  );
  const buttons = [];
  if (dismissable && dismissLabel) buttons.push(ui.button({ label: dismissLabel, variant: 'ghost', onClick: () => finish(onDismiss) }));
  buttons.push(ui.button({ label: actionLabel, variant: 'primary', onClick: () => finish(onAction) }));
  const dialog = h(
    'div',
    { class: 'yc-onboard', attrs: { role: 'dialog', 'aria-modal': 'true' } },
    dismissable && h('button', { type: 'button', class: 'yc-onboard-close', attrs: { 'aria-label': 'Dismiss' }, onClick: () => finish(onDismiss) }, ui.icon('x')),
    h('div', { class: 'yc-onboard-hero' }, h('div', { class: 'yc-onboard-hero-glow' }), h('div', { class: 'yc-onboard-hero-icon' }, ui.icon(icon ?? 'sparkles'))),
    h('h2', { class: 'yc-onboard-title' }, title),
    subtitle && h('p', { class: 'yc-onboard-subtitle' }, subtitle),
    rowsEl.length ? h('div', { class: 'yc-onboard-rows' }, rowsEl) : null,
    h('div', { class: 'yc-onboard-actions' }, buttons),
  );
  const backdrop = h('div', { class: 'yc-onboard-backdrop', onMousedown: (event) => event.target === backdrop && dismissable && finish(onDismiss) }, dialog);
  doc.addEventListener('keydown', onKey, true);
  return backdrop;
}

class OnboardingScreen {
  constructor(client, config, storageKey) {
    this.client = client;
    this.config = config ?? {};
    this.storageKey = storageKey;
  }

  get enabled() {
    return this.config !== false && this.config?.enabled !== false;
  }

  #store() {
    return this.client.storage.namespace(SEEN_NAMESPACE);
  }

  /** Marks the screen as seen without showing it, so it won't appear next time either. */
  markSeen() {
    this.#store().set(this.storageKey, this.client.version);
  }

  /** Clears the seen flag so it shows again next time the client app starts (or call show() now). */
  reset() {
    this.#store().delete(this.storageKey);
  }
}

/** Shown the first time the client app runs (nothing saved yet). `welcome: false` turns it off. */
export class Welcome extends OnboardingScreen {
  constructor(client, config) {
    super(client, config, 'welcomeSeenVersion');
  }

  shouldShow() {
    return this.enabled && !this.#store().has(this.storageKey);
  }

  #store() {
    return this.client.storage.namespace(SEEN_NAMESPACE);
  }

  /** Shows the welcome screen right now, regardless of whether it's been seen. */
  show() {
    const doc = globalThis.document;
    if (!doc?.body) return () => {};
    const { client, config } = this;
    const backdrop = panel(client, {
      icon: config.icon ?? 'sparkles',
      title: fill(config.title ?? 'Welcome to {name}', client),
      subtitle: fill(config.subtitle ?? null, client),
      rows: (config.steps ?? []).map((s) => ({ icon: s.icon, title: fill(s.title, client), description: fill(s.description, client) })),
      actionLabel: config.actionLabel ?? 'Get started',
      dismissLabel: config.dismissible === false ? null : config.dismissLabel ?? 'Skip',
      dismissable: config.dismissible !== false,
      onAction: () => this.markSeen(),
      onDismiss: () => this.markSeen(),
    });
    doc.body.appendChild(backdrop);
    return () => backdrop.remove();
  }

  maybeShow() {
    if (this.shouldShow()) this.show();
  }
}

/** Shown after an update, once, when there are entries configured. `whatsNew: false` turns it off. */
export class WhatsNew extends OnboardingScreen {
  constructor(client, config) {
    super(client, config, 'whatsNewSeenVersion');
  }

  shouldShow() {
    if (!this.enabled || !(this.config.entries ?? []).length) return false;
    return this.#store().get(this.storageKey) !== this.client.version;
  }

  #store() {
    return this.client.storage.namespace(SEEN_NAMESPACE);
  }

  /** Shows the what's new screen right now, regardless of version. */
  show() {
    const doc = globalThis.document;
    if (!doc?.body) return () => {};
    const { client, config } = this;
    const backdrop = panel(client, {
      icon: config.icon ?? 'rocket',
      title: fill(config.title ?? "What's new in {name} {version}", client),
      subtitle: fill(config.subtitle ?? null, client),
      rows: (config.entries ?? []).map((e) => ({ icon: e.icon, title: fill(e.title, client), description: fill(e.description, client) })),
      actionLabel: config.actionLabel ?? 'Got it',
      dismissLabel: config.dismissible === false ? null : config.dismissLabel ?? null,
      dismissable: config.dismissible !== false,
      onAction: () => this.markSeen(),
      onDismiss: () => this.markSeen(),
    });
    doc.body.appendChild(backdrop);
    return () => backdrop.remove();
  }

  maybeShow() {
    if (this.shouldShow()) this.show();
  }
}

export const onboardingCSS = `
.yc-onboard-backdrop{position:fixed;inset:0;z-index:2147483100;background:#0009;display:flex;align-items:center;justify-content:center;padding:20px;animation:yc-onboard-fade .18s ease-out}
.yc-onboard-backdrop.yc-onboard-leave{animation:yc-onboard-fade .18s ease-in reverse}
.yc-onboard-backdrop.yc-onboard-leave .yc-onboard{animation:yc-onboard-in .18s ease-in reverse}
.yc-onboard{position:relative;background:var(--bg-float,#1b1c21);color:var(--text,#ececf1);border:1px solid var(--border);border-radius:20px;box-shadow:var(--shadow,0 20px 60px #0008);width:min(440px,100%);max-height:90vh;overflow:auto;padding:28px 26px 24px;text-align:center;animation:yc-onboard-in .22s cubic-bezier(.2,.8,.2,1)}
.yc-onboard-close{position:absolute;top:14px;right:14px;width:28px;height:28px;border-radius:999px;border:none;background:var(--bg-active,#2a2b31);color:var(--text-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.yc-onboard-close:hover{background:var(--bg-hover,#34353c);color:var(--text)}
.yc-onboard-close .yc-icon{width:14px;height:14px}
.yc-onboard-hero{position:relative;width:64px;height:64px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center}
.yc-onboard-hero-glow{position:absolute;inset:0;border-radius:999px;background:radial-gradient(circle,var(--accent) 0%,transparent 70%);opacity:.35;animation:yc-onboard-pulse 2.4s ease-in-out infinite}
.yc-onboard-hero-icon{position:relative;width:64px;height:64px;border-radius:999px;background:var(--bg-active,#2a2b31);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--accent);animation:yc-onboard-pop .4s cubic-bezier(.2,.8,.2,1) .05s backwards}
.yc-onboard-hero-icon .yc-icon{width:28px;height:28px}
.yc-onboard-title{margin:0 0 6px;font-size:20px;font-weight:700}
.yc-onboard-subtitle{margin:0 0 18px;color:var(--text-muted);font-size:14px;line-height:1.5}
.yc-onboard-rows{display:flex;flex-direction:column;gap:12px;text-align:left;margin-bottom:20px}
.yc-onboard-row{display:flex;gap:12px;align-items:flex-start;opacity:0;animation:yc-onboard-row-in .35s ease-out forwards;animation-delay:calc(120ms + var(--yc-i) * 70ms)}
.yc-onboard-row-icon{flex-shrink:0;width:34px;height:34px;border-radius:10px;background:var(--bg-active,#2a2b31);display:flex;align-items:center;justify-content:center;color:var(--accent)}
.yc-onboard-row-icon .yc-icon{width:18px;height:18px}
.yc-onboard-row-title{font-weight:600;font-size:14px}
.yc-onboard-row-desc{color:var(--text-muted);font-size:13px;margin-top:2px;line-height:1.4}
.yc-onboard-actions{display:flex;justify-content:center;gap:10px}
@keyframes yc-onboard-fade{from{opacity:0}to{opacity:1}}
@keyframes yc-onboard-in{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
@keyframes yc-onboard-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes yc-onboard-pulse{0%,100%{opacity:.25;transform:scale(1)}50%{opacity:.45;transform:scale(1.15)}}
@keyframes yc-onboard-row-in{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .yc-onboard-backdrop,.yc-onboard,.yc-onboard-hero-icon,.yc-onboard-hero-glow,.yc-onboard-row{animation:none!important;opacity:1!important;transform:none!important}
}
`;
