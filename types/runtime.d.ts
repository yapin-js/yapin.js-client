// Types for code that runs in the Yapin’ page: client app entry files and plugins.
// import { definePlugin } from 'yapin.js-client/runtime';

export declare const version: string;
export declare const apiVersion: number;

// ---------- settings ----------

interface SettingBase<T> {
  label?: string;
  description?: string;
  default?: T;
  /** Groups settings under a heading in the generated form. */
  group?: string;
  order?: number;
  hidden?: boolean | ((settings: Settings) => boolean);
  disabled?: boolean | ((settings: Settings) => boolean);
  /** Return true, false, or a message saying what's wrong. */
  validate?: (value: T, settings: Settings) => boolean | string;
  onChange?: (value: T, old: T, key: string) => void;
}

export type SettingDefinition =
  | ({ type: 'switch' | 'boolean' } & SettingBase<boolean>)
  | ({ type: 'text' | 'string' | 'textarea'; placeholder?: string; minLength?: number; maxLength?: number; pattern?: string; patternFlags?: string; patternMessage?: string; trim?: boolean; secret?: boolean; rows?: number } & SettingBase<string>)
  | ({ type: 'number'; min?: number; max?: number; step?: number; integer?: boolean } & SettingBase<number>)
  | ({ type: 'slider'; min: number; max: number; step?: number; unit?: string } & SettingBase<number>)
  | ({ type: 'select'; options: Array<string | number | { label: string; value: unknown; description?: string }>; multiple?: boolean } & SettingBase<unknown>)
  | ({ type: 'color' } & SettingBase<string>)
  | ({ type: 'list'; maxItems?: number; placeholder?: string } & SettingBase<string[]>)
  | ({ type: 'button'; action: (context: unknown) => unknown; buttonLabel?: string; variant?: 'primary' | 'ghost' | 'danger' } & Omit<SettingBase<never>, 'default'>)
  | ({ type: 'custom'; render: (props: { value: unknown; settings: Settings; context: unknown; save: (value: unknown) => void; disabled: boolean; ui: UI }) => Node | { element: Node; dispose?: () => void } } & SettingBase<unknown>);

export type SettingsSchema = Record<string, SettingDefinition>;

export declare class Settings {
  readonly owner: string;
  readonly definitions: Record<string, SettingDefinition & { key: string; label: string; order: number }>;
  get<T = unknown>(key: string): T;
  all(): Record<string, unknown>;
  /** Throws a ClientError with a readable message if the value isn't valid. */
  set(key: string, value: unknown): this;
  check(key: string, value: unknown): true | string;
  reset(key?: string): this;
  state(key: string): { hidden: boolean; disabled: boolean };
  onChange(key: string, fn: (value: unknown, old: unknown, key: string) => void): () => void;
  onChange(fn: (value: unknown, old: unknown, key: string) => void): () => void;
}

export declare const SettingTypes: Record<string, unknown>;
export declare function normalizeSchema(schema: SettingsSchema, owner?: string): Settings['definitions'];

// ---------- storage ----------

export interface Store {
  readonly namespace: string;
  get<T = unknown>(key: string, fallback?: T): T;
  has(key: string): boolean;
  set(key: string, value: unknown): this;
  update<T>(key: string, fn: (current: T) => T, fallback?: T): this;
  delete(key: string): boolean;
  keys(): string[];
  all(): Record<string, unknown>;
  clear(): void;
  onChange(fn: (key: string, value: unknown, old: unknown) => void): () => void;
  flush(): void;
}

// ---------- ui ----------

export type Child = Node | string | number | null | undefined | false | Child[];
export declare function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown> | null, ...children: Child[]): HTMLElementTagNameMap[K];
export declare function h(tag: string | Node, props?: Record<string, unknown> | null, ...children: Child[]): HTMLElement;
/** SVG markup → a cleaned SVG element (no scripts, handlers or external links), or null. */
export declare function svg(markup: string): SVGSVGElement | null;

export declare class UI {
  h: typeof h;
  svg: typeof svg;
  heading(text: string, level?: number): HTMLElement;
  hint(text: string): HTMLElement;
  section(options: { title?: string; description?: string; children?: Child[] }): HTMLElement;
  card(options: { title: string; meta?: string; actions?: Node[]; children?: Child[]; icon?: string | Node }): HTMLElement;
  tag(text: string, variant?: 'warn' | 'danger'): HTMLElement;
  empty(text: string): HTMLElement;
  icon(source: string | Node): HTMLElement | null;
  /** Adds icons to this client app's set as `{ name: '<svg…>' }`; a name matching a built-in replaces it. */
  registerIcons(icons: Record<string, string>): this;
  /** Every icon name available: the built-ins plus any registered. */
  iconNames(): string[];
  button(options: { label: string; variant?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean; title?: string; icon?: string; onClick?: (event: MouseEvent) => unknown }): HTMLButtonElement;
  link(options: { href: string; label?: string; title?: string }): HTMLElement;
  switch(options: { checked?: boolean; disabled?: boolean; label?: string; onChange?: (checked: boolean, event: Event) => void }): HTMLInputElement;
  toggleRow(options: { label: string; description?: string; checked?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void }): HTMLElement;
  field(options: { label?: string; description?: string; input: Node; error?: string; id?: string }): HTMLElement;
  textInput(options: { value?: string; placeholder?: string; type?: string; maxLength?: number; disabled?: boolean; onInput?: (value: string) => void; onChange?: (value: string) => void }): HTMLInputElement;
  textarea(options: { value?: string; placeholder?: string; rows?: number; disabled?: boolean; onInput?: (value: string) => void; onChange?: (value: string) => void }): HTMLTextAreaElement;
  select<T>(options: { value?: T | T[]; options: Array<T | { label: string; value: T }>; multiple?: boolean; disabled?: boolean; onChange?: (value: T | T[]) => void }): HTMLSelectElement;
  slider(options: { value?: number; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean; onInput?: (value: number) => void; onChange?: (value: number) => void }): HTMLElement;
  colorInput(options: { value?: string; disabled?: boolean; onInput?: (value: string) => void; onChange?: (value: string) => void }): HTMLElement;
  listEditor(options: { value?: string[]; placeholder?: string; disabled?: boolean; onChange?: (value: string[]) => void }): HTMLElement;
  keyValue(rows: Array<{ label: string; value: Child }>): HTMLElement;
  toast(message: string, options?: { type?: 'info' | 'success' | 'warning' | 'error'; timeout?: number; action?: { label: string; onClick: () => void } }): () => void;
  dialog<T>(options: { title?: string; message?: string; content?: Node; buttons?: Array<{ label: string; variant?: 'primary' | 'ghost' | 'danger'; value: T | (() => T | Promise<T>) }>; dismissable?: boolean }): Promise<T | null>;
  confirm(options: { title?: string; message?: string; content?: Node; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean>;
  prompt(options: { title?: string; message?: string; placeholder?: string; value?: string; confirmLabel?: string; validate?: (value: string) => true | string | Promise<true | string> }): Promise<string | null>;
  /** A form for a Settings object; changes save as they're made. */
  form(settings: Settings, options?: { context?: unknown }): { element: HTMLElement; dispose(): void };
}

// ---------- pages ----------

export interface PageContext {
  client: Client;
  ui: UI;
  h: typeof h;
  page: PageHandle;
  /** Runs when the page closes. */
  onDispose(fn: () => void): void;
  /** Closes the page and goes back to the setting the person was on. */
  close(): void;
}

export interface PageDefinition {
  /** Lowercase letters, digits and dashes. */
  id: string;
  title: string;
  /** Section (nav label) id; 'main' (labelled with the client app's name) by default. */
  section?: string;
  order?: number;
  /** SVG markup, an https or data: image URL, or an element. */
  icon?: string | Node;
  /** Small label next to the nav item, like "NEW". */
  badge?: string;
  visible?: boolean | ((client: Client) => boolean);
  /** Draw the page into `root`. Return a cleanup function if you need one. */
  render(root: HTMLElement, ctx: PageContext): void | (() => void);
}

export interface PageHandle {
  id: string;
  update(changes: Partial<PageDefinition>): PageHandle;
  remove(): boolean;
  open(options?: { openSettings?: boolean }): boolean;
}

export interface PageManager {
  add(definition: PageDefinition, options?: { owner?: unknown }): PageHandle;
  get(id: string): PageHandle | null;
  has(id: string): boolean;
  list(): Array<{ id: string; title: string; section: string; order: number; owner: unknown }>;
  update(id: string, changes: Partial<PageDefinition>): PageHandle;
  remove(id: string): boolean;
  open(id: string, options?: { openSettings?: boolean }): boolean;
  section(id: string, options: { label?: string; order?: number }): this;
  removeSection(id: string): void;
  sections(): Array<{ id: string; label: string; order: number }>;
}

// ---------- about ----------

export interface AboutField {
  label?: string;
  value?: string | number | (() => string);
  /** Makes the value a link (https only). */
  href?: string | null;
  /** Adds a Copy button: true copies the value, a string copies that. */
  copy?: boolean | string;
  code?: boolean;
  order?: number;
  hidden?: boolean;
}

export type AboutLayout = 'rows' | 'chips' | 'header';

export interface AboutPage {
  /** id is '<section>.<name>', like 'git.commit' or 'support.discord'. */
  set(id: string, field: AboutField): this;
  get(id: string): (AboutField & { id: string; section: string }) | null;
  remove(id: string): boolean;
  fields(): Array<AboutField & { id: string; section: string }>;
  /** 'rows' (default), 'chips' (compact pills, for links) or 'header' (the card at the top). */
  section(id: string, options: { title?: string | null; order?: number; layout?: AboutLayout }): this;
  sections(): Array<{ id: string; title: string | null; order: number; layout: AboutLayout }>;
  removeSection(id: string): this;
  action(id: string, options: { label: string; icon?: string; run: (client: Client) => unknown; variant?: 'primary' | 'ghost' | 'danger'; order?: number }): this;
  removeAction(id: string): this;
  /** Everything on the page as text, plus enabled plugins, themes and recent errors. */
  debugInfo(): string;
}

// ---------- welcome / what's new ----------

export interface OnboardingScreen {
  readonly enabled: boolean;
  /** Shows it right now, regardless of whether it's been seen. */
  show(): () => void;
  /** Marks it seen without showing it. */
  markSeen(): void;
  /** Clears the seen flag so it's shown again next start (or call show() now). */
  reset(): void;
  shouldShow(): boolean;
}

export interface Welcome extends OnboardingScreen {}
export interface WhatsNew extends OnboardingScreen {}

// ---------- themes ----------

export interface ThemeVariable {
  variable: `--${string}`;
  type?: 'color' | 'number' | 'slider' | 'select' | 'switch' | 'text';
  default?: unknown;
  label?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  on?: string;
  off?: string;
}

export interface ThemeDefinition {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  authors?: Array<{ name: string; url?: string }>;
  tags?: string[];
  mode?: 'dark' | 'light' | 'any';
  preview?: string;
  website?: string;
  css?: string;
  /** `{ '--accent': '#fff' }`, or `{ dark: { … }, light: { … } }`. */
  variables?: Record<string, string | Record<string, string>>;
  /** Variables people can change in the Themes page. */
  vars?: ThemeVariable[];
  settings?: SettingsSchema;
  enabledByDefault?: boolean;
  order?: number;
}

export interface ThemeInfo extends Omit<ThemeDefinition, 'css' | 'vars' | 'settings'> {
  id: string;
  name: string;
  source: 'bundled' | 'user' | 'code';
  /** How much this client trusts the plugin. Decided by the loader, never by the plugin. */
  trust: Trust;
  file: string | null;
  enabled: boolean;
  hasSettings: boolean;
}

export interface ThemeHandle {
  id: string;
  enable(): boolean;
  disable(): boolean;
  toggle(on?: boolean): boolean;
  remove(): boolean;
  isEnabled(): boolean;
  settings: Settings;
  info(): ThemeInfo;
}

export interface ThemeManager {
  readonly multiple: boolean;
  readonly enabledIds: string[];
  customCSS: string;
  add(definition: ThemeDefinition, options?: { source?: 'bundled' | 'user' | 'code'; file?: string; owner?: unknown }): ThemeHandle;
  parse(text: string, options?: { file?: string; source?: string }): ThemeDefinition;
  remove(id: string): boolean;
  get(id: string): ThemeHandle | null;
  has(id: string): boolean;
  list(): ThemeInfo[];
  isEnabled(id: string): boolean;
  enable(id: string): boolean;
  disable(id: string): boolean;
  toggle(id: string, on?: boolean): boolean;
  settings(id: string): Settings;
}

export declare const VARIABLE_SELECTOR: string;
export declare const StyleOrder: Readonly<{ framework: number; plugin: number; base: number; theme: number; custom: number }>;
export declare function variablesCSS(variables: ThemeDefinition['variables']): string;

// ---------- badges ----------

export interface Badge {
  id: string;
  label?: string;
  description?: string;
  /** https or data: image URL, or SVG markup (cleaned before use). */
  icon?: string;
  /** https link opened when the badge is clicked. */
  href?: string;
  color?: string;
  background?: string;
  priority?: number;
}

export interface BadgeProvider {
  id: string;
  name?: string;
  priority?: number;
  /** A JSON file: `{ badges: { id: Badge }, users: { userId: [badgeId | Badge] } }`. Its origin must be allowed. */
  url?: string;
  /** How often to reload `url` or `load()`: '30m', '1h' (at least a minute). */
  refresh?: string | number;
  /** Your own loader, returning the same shape as the JSON file. */
  load?: () => Promise<unknown>;
  /** Badges for one person. */
  get?: (userId: string) => Badge[] | Promise<Badge[]>;
}

export interface BadgeSlot {
  selector: string;
  position?: 'append' | 'prepend' | 'before' | 'after';
  size?: 'sm' | 'md' | 'lg' | number;
  /** Prop paths to find the user id with, or a function. */
  userIdProps?: string[];
  userId?: (element: Element) => string | null;
}

export interface BadgeManager {
  addProvider(provider: BadgeProvider, options?: { owner?: unknown }): () => boolean;
  removeProvider(id: string): boolean;
  providers(): Array<{ id: string; name: string; url: string | null; loaded: boolean }>;
  /** Gives one person a badge; returns a function that takes it away. */
  add(userId: string, badge: Badge, options?: { owner?: unknown }): () => void;
  for(userId: string): Promise<Array<Badge & { provider: string }>>;
  peek(userId: string): Array<Badge & { provider: string }> | null;
  refresh(providerId?: string): Promise<void>;
  render(badges: Badge[], options?: { size?: BadgeSlot['size'] }): HTMLElement;
  slots(): Record<string, BadgeSlot | null>;
  /** A slot from code; `userId` may be a function of the element. Returns a remover. */
  addSlot(name: string, slot: BadgeSlot): () => void;
  removeSlot(name: string): void;
}

export declare function parseBadgeTable(data: unknown): Map<string, Badge[]>;

// ---------- api ----------

export interface RequestOptions {
  url?: string;
  service?: string;
  path?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  timeout?: number;
  retries?: number;
  /** Reuse a GET response for this long: '30s', '5m'. */
  cache?: string | number;
  responseType?: 'json' | 'text' | 'auto';
}

export interface ServiceClient {
  name: string;
  request<T = unknown>(options: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
}

export interface ServiceConfig {
  baseURL: string;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  query?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  cache?: string | number;
  auth?: { secret: string; type?: 'bearer' | 'header'; scheme?: string; header?: string };
}

export interface ApiClient {
  readonly allowedOrigins: Set<string>;
  isAllowed(url: string): boolean;
  addService(name: string, config: ServiceConfig): ServiceClient;
  removeService(name: string): boolean;
  services(): string[];
  service(name: string): ServiceClient;
  request<T = unknown>(options: RequestOptions): Promise<T>;
  clearCache(prefix?: string): void;
  download(url: string, options?: { maxBytes?: number; allowedHosts?: string[]; timeout?: number }): Promise<string>;
}

export interface Secrets {
  /** True on desktop (encrypted by the OS), false in a browser (plain localStorage). */
  readonly secure: boolean;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<unknown>;
  delete(name: string): Promise<unknown>;
}

// ---------- modules, patching, react ----------

export type ModuleFilter = (exports: any) => boolean;

export declare const filters: {
  byProps(...props: string[]): ModuleFilter;
  byCode(...strings: string[]): ModuleFilter;
  byName(name: string): ModuleFilter;
};

export declare class ModuleFinder {
  readonly available: boolean;
  readonly filters: typeof filters;
  entries(): IterableIterator<[string | number, any]>;
  find<T = any>(filter: ModuleFilter, options?: { deep?: boolean }): T | null;
  findAll<T = any>(filter: ModuleFilter, options?: { deep?: boolean }): T[];
  findByProps<T = any>(...props: string[]): T | null;
  findByCode<T = any>(...strings: string[]): T | null;
  findModuleByCode<T = any>(...strings: string[]): T | null;
  waitFor<T = any>(filter: ModuleFilter, options?: { timeout?: number; deep?: boolean }): Promise<T | null>;
  lazy<T = any>(filter: ModuleFilter, options?: { deep?: boolean }): () => T | null;
}

export declare class Patcher {
  before<T extends object>(target: T, key: keyof T & string, fn: (args: any[], thisArg: any) => any[] | void, options?: { owner?: unknown }): () => void;
  instead<T extends object>(target: T, key: keyof T & string, fn: (args: any[], original: (...args: any[]) => any, thisArg: any) => any, options?: { owner?: unknown }): () => void;
  after<T extends object>(target: T, key: keyof T & string, fn: (args: any[], result: any, thisArg: any) => any, options?: { owner?: unknown }): () => void;
  unpatchAll(owner: unknown): number;
  static isPatched(target: object, key: string): boolean;
}

export interface ReactHelpers {
  fiberOf(node: Node): any;
  propsOf(node: Node): any;
  findProps(node: Node, predicate: (props: any, fiber: any) => boolean, options?: { maxDepth?: number }): any;
  findValue(node: Node, paths: string[], options?: { maxDepth?: number }): any;
  findUserId(node: Node, paths?: string[], options?: { maxDepth?: number }): string | null;
}

// ---------- host ----------

export interface HostConfig {
  selectors: Record<string, string>;
  classes: Record<string, string>;
  userSettingsLabel: string;
  userIdProps: string[];
  isUserSettings?: (nav: Element) => boolean;
}

export declare const defaultHost: Readonly<HostConfig>;

export interface Host {
  readonly config: HostConfig;
  readonly selectors: HostConfig['selectors'];
  readonly classes: HostConfig['classes'];
  readonly platform: 'desktop' | 'web';
  readonly isDesktop: boolean;
  /** window.yapperDesktop, the desktop app's own bridge, or null in a browser. */
  readonly desktop: any;
  readonly desktopVersion: string | null;
  readonly colorScheme: 'dark' | 'light';
  onColorSchemeChange(fn: (scheme: 'dark' | 'light') => void): () => void;
  isUserSettings(nav: Element): boolean;
  className(...keys: string[]): string;
}

// ---------- plugins ----------

export interface PluginPatch {
  find: { props: string[] } | { code: string[] } | ((modules: ModuleFinder, ctx: PluginContext) => any);
  method: string;
  /** Wait for the module to load (up to `timeout` ms) instead of failing if it isn't there yet. */
  wait?: boolean;
  timeout?: number;
  /** Log a warning instead of failing the plugin when the target can't be found. */
  optional?: boolean;
  before?: (args: any[], thisArg: any, ctx: PluginContext) => any[] | void;
  instead?: (args: any[], original: (...args: any[]) => any, thisArg: any, ctx: PluginContext) => any;
  after?: (args: any[], result: any, thisArg: any, ctx: PluginContext) => any;
}

export interface PluginDefinition {
  /** Lowercase letters, digits and dashes. */
  id: string;
  name?: string;
  description?: string;
  version?: string;
  authors?: Array<string | { name: string; url?: string }>;
  tags?: string[];
  website?: string;
  /** The plugin API version this was written for (default: the current one). */
  apiVersion?: number;
  minClientVersion?: string;
  platforms?: Array<'desktop' | 'web'>;
  dependencies?: string[];
  conflicts?: string[];
  enabledByDefault?: boolean;
  /** Bundled plugins only: can't be turned off. */
  required?: boolean;
  hidden?: boolean;
  settings?: SettingsSchema;
  /** CSS while the plugin runs; a function gets the current settings and reruns when they change. */
  styles?: string | ((settings: Record<string, unknown>) => string);
  /** Client events → handlers. */
  events?: Record<string, (...args: any[]) => unknown>;
  /** Selectors → called for each matching element; may return a cleanup. */
  observe?: Record<string, (element: Element, ctx: PluginContext) => void | (() => void)>;
  patches?: PluginPatch[];
  /** A settings page of the plugin's own (title defaults to the plugin's name). */
  page?: Omit<PageDefinition, 'id' | 'title'> & { title?: string };
  badges?: BadgeProvider | BadgeProvider[];
  start?(ctx: PluginContext): void | Promise<void>;
  stop?(ctx: PluginContext): void;
  onSettingsChange?(key: string, value: unknown, ctx: PluginContext, old: unknown): void;
}

export declare function definePlugin<T extends PluginDefinition>(definition: T): T;
export declare function defineTheme<T extends ThemeDefinition>(definition: T): T;
export declare function definePage<T extends PageDefinition>(definition: T): T;
export declare function defineBadgeProvider<T extends BadgeProvider>(definition: T): T;

export type Trust = 'bundled' | 'verified' | 'signed' | 'unverified';
export declare const Trust: Readonly<{ bundled: 'bundled'; verified: 'verified'; signed: 'signed'; unverified: 'unverified' }>;

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string | null;
  authors: Array<{ name: string; url?: string }>;
  tags: string[];
  website: string | null;
  source: 'bundled' | 'user' | 'code';
  /** How much this client trusts the plugin. Decided by the loader, never by the plugin. */
  trust: Trust;
  file: string | null;
  required: boolean;
  hidden: boolean;
  dependencies: string[];
  status: 'stopped' | 'starting' | 'running' | 'error' | 'crashed' | 'incompatible';
  error: string | null;
  enabled: boolean;
  hasSettings: boolean;
  compatible: boolean;
  incompatible: string | null;
}

export declare class PluginContext {
  readonly client: Client;
  readonly id: string;
  readonly plugin: PluginInfo;
  readonly logger: Logger;
  readonly settings: Settings;
  /** Saved data for this plugin (separate from its settings). */
  readonly storage: Store;
  readonly ui: UI;
  readonly h: typeof h;
  readonly host: Host;
  readonly dom: { observe(selector: string, fn: (element: Element, ctx: PluginContext) => void | (() => void)): () => void; waitFor(selector: string, options?: { timeout?: number }): Promise<Element | null> };
  readonly react: ReactHelpers;
  readonly modules: ModuleFinder;
  readonly api: ApiClient;
  readonly patch: {
    before: Patcher['before'];
    after: Patcher['after'];
    instead: Patcher['instead'];
  };
  readonly pages: { add(definition: PageDefinition): () => boolean; get(id: string): PageHandle | null };
  readonly badges: { addProvider(provider: BadgeProvider): () => boolean; add(userId: string, badge: Badge): () => void };
  readonly themes: { add(definition: ThemeDefinition): () => boolean };
  css(text: string): { update(css: string): void; remove(): void; readonly error: Error | null };
  observe(selector: string, fn: (element: Element, ctx: PluginContext) => void | (() => void), options?: { filter?: (element: Element) => boolean }): () => void;
  on(event: string, fn: (...args: any[]) => unknown): () => boolean;
  listen<K extends keyof WindowEventMap>(target: EventTarget, type: K | string, fn: (event: Event) => unknown, options?: AddEventListenerOptions): () => void;
  setTimeout(fn: () => unknown, ms: number): ReturnType<typeof setTimeout>;
  setInterval(fn: () => unknown, ms: number): ReturnType<typeof setInterval>;
  onStop(fn: () => void): this;
  toast: UI['toast'];
}

export interface PluginHandle {
  id: string;
  info(): PluginInfo;
  enable(): Promise<boolean>;
  disable(): Promise<boolean>;
  toggle(on?: boolean): Promise<boolean>;
  start(): Promise<boolean>;
  stop(): boolean;
  restart(): Promise<boolean>;
  remove(): boolean;
  settings: Settings;
}

export declare class PluginManager {
  readonly started: boolean;
  add(definition: PluginDefinition, options?: { source?: 'bundled' | 'user' | 'code'; file?: string; owner?: unknown }): PluginHandle;
  addSource(text: string, options?: { file?: string; source?: 'user' | 'code' }): Promise<PluginHandle>;
  remove(id: string): boolean;
  has(id: string): boolean;
  get(id: string): PluginHandle | null;
  info(id: string): PluginInfo;
  list(options?: { includeHidden?: boolean }): PluginInfo[];
  isEnabled(id: string): boolean;
  isRunning(id: string): boolean;
  enable(id: string): Promise<boolean>;
  disable(id: string): Promise<boolean>;
  toggle(id: string, on?: boolean): Promise<boolean>;
  start(id: string): Promise<boolean>;
  stop(id: string): boolean;
  restart(id: string): Promise<boolean>;
  sourceOf(id: string): string | null;
}

export interface UserContent {
  allowed(kind: 'plugins' | 'themes'): boolean;
  canInstallFromURL(kind: 'plugins' | 'themes'): boolean;
  /** Asks the person first; resolves with the id, or null if they said no. */
  install(kind: 'plugins' | 'themes', options: { url?: string; text?: string; file?: string; confirm?: boolean }): Promise<string | null>;
  uninstall(kind: 'plugins' | 'themes', id: string): Promise<boolean>;
  openFolder(kind: 'plugins' | 'themes' | 'data'): Promise<unknown> | undefined;
}

// ---------- client ----------

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(name: string): Logger;
  history: { entries: Array<{ time: number; level: string; name: string; message: string }>; limit: number };
}

export interface Emitter {
  on(event: string, listener: (...args: any[]) => unknown): () => boolean;
  once(event: string, listener: (...args: any[]) => unknown): () => boolean;
  off(event: string, listener: (...args: any[]) => unknown): void;
  emit(event: string, ...args: unknown[]): boolean;
  wait(event: string, options?: { timeout?: number; filter?: (...args: any[]) => boolean }): Promise<unknown[]>;
  listenerCount(event: string): number;
}

/**
 * Client events: 'ready', 'error', 'settings:open', 'settings:close', 'page:add', 'page:remove',
 * 'page:open', 'page:close', 'plugin:add' | 'update' | 'remove' | 'enable' | 'disable' | 'start' |
 * 'stop' | 'error' | 'crash' | 'install' | 'uninstall', 'theme:add' | 'update' | 'remove' | 'enable' |
 * 'disable' | 'install' | 'uninstall', 'badges:update'.
 */
export declare class Client {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly manifest: Readonly<Record<string, any>>;
  readonly config: Readonly<Record<string, any>>;
  /** True when started in safe mode (no plugins or themes). */
  readonly safeMode: boolean;
  readonly environment: Readonly<{ electron?: string; chrome?: string; node?: string; os?: string; platform?: string }>;
  readonly ready: Promise<Client>;
  readonly isReady: boolean;
  readonly logger: Logger;
  readonly events: Emitter;
  readonly storage: { namespace(name: string): Store };
  /** The client app's own settings (config.settings); shown on a Settings page. */
  readonly settings: Settings;
  readonly host: Host;
  readonly dom: { observe(selector: string, fn: (element: Element) => void | (() => void), options?: { filter?: (element: Element) => boolean }): () => void; waitFor(selector: string, options?: { timeout?: number }): Promise<Element | null> };
  readonly styles: { add(css: string, options?: { id?: string; order?: number }): { update(css: string): void; remove(): void; readonly error: Error | null } };
  readonly ui: UI;
  readonly react: ReactHelpers;
  readonly modules: ModuleFinder;
  readonly patcher: Patcher;
  readonly api: ApiClient;
  readonly secrets: Secrets;
  readonly pages: PageManager;
  readonly themes: ThemeManager;
  readonly plugins: PluginManager;
  readonly badges: BadgeManager;
  readonly userContent: UserContent;
  /** null when the client app turned the About page off. */
  readonly about: AboutPage | null;
  /** null when the client app turned the welcome screen off. */
  readonly welcome: Welcome | null;
  /** null when the client app turned the what's new screen off. */
  readonly whatsNew: WhatsNew | null;
  reportError(error: unknown, tags?: Record<string, unknown>): void;
  openExternal(url: string): boolean;
  stop(): void;
}

export declare function getClient(): Client | null;

export declare class ClientError extends Error {
  code: string;
}
export declare class ApiError extends ClientError {
  status: number;
  body: unknown;
  url?: string;
  method?: string;
}
export declare const ErrorCodes: Readonly<Record<string, string>>;
export declare function parseMeta(source: string): { meta: Record<string, any>; vars: ThemeVariable[] };
export declare function parseVar(text: string): ThemeVariable | null;
/** The exact bytes a plugin signature covers. Frozen; see docs/plugin-development.md. */
export declare function canonicalText(source: string): string;
/** The `@signature <algorithm> <keyId> <base64>` line, or null when there isn't a readable one. */
export declare function readSignature(source: string): { algorithm: string; keyId: string; value: string; canonical: string } | null;
