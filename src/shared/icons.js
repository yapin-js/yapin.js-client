/**
 * A small built-in icon set, usable anywhere an "icon" option is accepted (page icons, About fields,
 * cards, toasts, dialogs, the welcome and what's new screens…) by name: `icon: 'rocket'`. Each is a
 * plain, stroke-based 24×24 SVG that inherits its colour from CSS (`currentColor`), so it follows
 * whatever text colour it's placed in, in any theme.
 *
 * Anywhere that takes an icon also still takes raw SVG markup, an https/data image URL, or an element;
 * names here are just a shortcut so client apps don't have to carry their own SVGs for common things.
 */
export const ICONS = Object.freeze({
  sparkles:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l1.8 1.8M15.9 15.9l1.8 1.8M17.7 6.3l-1.8 1.8M8.1 15.9l-1.8 1.8"/><circle cx="12" cy="12" r="2.1"/></svg>',
  rocket:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 9.5c2-2 3-5 2.6-6.6-1.6-.4-4.6.6-6.6 2.6-1.8 1.8-4.3 5.2-5 7l2.9 3c1.9-.7 5.3-3.2 7-5Z"/><path d="M9 15l-3 3M13.5 6.5l4 4M8 16.5c0 1.5-1 2.5-3.5 3 .5-2.5 1.5-3.5 3-3.5Z"/></svg>',
  puzzle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h3a1.5 1.5 0 0 1 0 3 1.5 1.5 0 0 0 0 3h3a1 1 0 0 1 1 1v3a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 0-3 0v3a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-3a1.5 1.5 0 0 1 0-3 1.5 1.5 0 0 0 0-3V6a1 1 0 0 1 1-1h3V4Z"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2a4 4 0 0 0 4-4c0-4.4-4-7.4-9-7.4Z"/><circle cx="7.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>',
  sliders:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h7M15 7h5M4 17h11M19 17h1M9 4.5v5M17 14.5v5"/></svg>',
  info:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".2" fill="currentColor"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  alertTriangle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".2" fill="currentColor"/></svg>',
  alertCircle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.5" r=".2" fill="currentColor"/></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  megaphone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a2 2 0 0 0 2 2h1l9 4V5l-9 4H5a2 2 0 0 0-2 2Z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 1 1 12 0c0 3 1 4.5 2 5.5H4c1-1 2-2.5 2-5.5Z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/><path d="M13 3h8v8"/><path d="M21 3 10 14"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-9.5-9.3C1.1 7.7 3 4.5 6.4 4.5c2 0 3.4 1.1 4.1 2.3.7-1.2 2.1-2.3 4.1-2.3 3.4 0 5.3 3.2 3.9 6.2C19.5 15.4 12 20 12 20Z"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3Z"/><path d="M9 12l2 2 4-4.5"/></svg>',
});

/** Looks up a built-in icon by name (case-insensitive). Returns raw SVG markup, or null. */
export function builtinIcon(name) {
  if (typeof name !== 'string') return null;
  return ICONS[name] ?? ICONS[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
}
