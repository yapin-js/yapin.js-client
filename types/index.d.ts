// Types for the Node side: the config file, building and installing.
import type { SettingsSchema, ServiceConfig, BadgeSlot, ThemeDefinition } from './runtime';

export declare const version: string;
export declare const apiVersion: number;

export interface Author {
  name: string;
  url?: string;
}

export interface UserInstallConfig {
  /** People may add their own (default true). */
  enabled?: boolean;
  install?: {
    /** "Install from link" (default true). */
    url?: boolean;
    /** Only these hosts (and their subdomains); empty means any https host. */
    allowedHosts?: string[];
    maxBytes?: number;
  };
}

export interface MarketingConfig {
  title?: string;
  pageTitle?: string;
  tagline?: string;
  /** Paragraphs; **bold**, *italic*, `code` and [links](https://…) work. */
  description?: string;
  badge?: string;
  /** Path, https URL or data: URL. */
  logo?: string;
  icon?: string;
  accent?: string;
  theme?: 'dark' | 'light' | 'auto';
  /** A colour, a CSS gradient, or an image path. */
  background?: string;
  features?: Array<{ icon?: string; title: string; text?: string }>;
  screenshots?: Array<string | { src: string; caption?: string }>;
  changelog?: Array<{ version: string; date?: string; notes: string[] }>;
  changelogTitle?: string;
  links?: Array<{ label: string; url: string }>;
  /** Shown under the panel. Defaults to an "unofficial modification" notice; false removes it. */
  notice?: string | false;
  terms?: { title?: string; text?: string; file?: string; requireAccept?: boolean };
  panelTitle?: string;
  footer?: string;
  /** Path to extra CSS for the page. */
  css?: string;
  lang?: string;
  /** Override any text the page shows (see installerStrings). */
  strings?: Partial<Record<keyof typeof installerStrings, string>>;
}

export interface TargetConfig {
  packageName?: string;
  productName?: string;
  executable?: Partial<Record<NodeJS.Platform, string>>;
  processName?: Partial<Record<NodeJS.Platform, string>>;
  locations?: Partial<Record<NodeJS.Platform, string[]>>;
}

export interface Config {
  /** Lowercase letters, digits and dashes; names folders and storage. Default: from package.json. */
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  authors?: Array<string | Author>;
  /** https links shown on the About page: { website, source, support, … }. */
  links?: Record<string, string>;
  icon?: string;
  /** Your code, run in the page: export default function setup(client) {}. */
  entry?: string;
  origins?: string[];
  outDir?: string;
  /** The client app's own settings, shown on a Settings page. */
  settings?: SettingsSchema;
  runtime?: { logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent' | null; logColor?: string; exposeGlobal?: string | null };
  plugins?: {
    dirs?: string[];
    enabled?: Record<string, boolean>;
    required?: string[];
    hidden?: string[];
    blocked?: string[];
    crash?: { limit?: number; window?: number };
    user?: UserInstallConfig;
  };
  themes?: {
    dirs?: string[];
    enabled?: Record<string, boolean>;
    multiple?: boolean;
    /** A CSS file always applied (the client app's own look). */
    css?: string | null;
    variables?: ThemeDefinition['variables'] | null;
    customCSS?: { enabled?: boolean; title?: string; description?: string | null };
    user?: UserInstallConfig;
  };
  /** Icons this client app adds to the built-in set, usable by name anywhere an `icon` is accepted. */
  icons?: {
    /** Folders with `.svg` icons; each is registered under its file name (`icons/brand.svg` -> `'brand'`). */
    dirs?: string[];
    /** Icons given inline as `{ name: '<svg…>' }`. Wins over a folder file of the same name, and a name matching a built-in replaces it. */
    set?: Record<string, string>;
  };
  pages?: {
    /** The nav label above the client app's pages (default: its name). */
    section?: string | null;
    /** 'start', 'end', 'before:<label>' or 'after:<label>'. */
    position?: string;
    plugins?: false | { title?: string; order?: number; intro?: string; emptyText?: string; icon?: string };
    themes?: false | { title?: string; order?: number; intro?: string; emptyText?: string; icon?: string };
    settings?: false | { title?: string; order?: number };
  };
  about?:
    | false
    | {
        title?: string;
        order?: number;
        icon?: string;
        /** Shown in the header card: a built-in icon name, SVG markup, or an https/data image URL. Default: the name's first letter. */
        logo?: string | null;
        intro?: string | null;
        sections?: Record<string, boolean | { title?: string | null; order?: number; layout?: 'rows' | 'chips' | 'header' }>;
        fields?: Record<string, false | string | { label?: string; value?: string; href?: string; copy?: boolean | string; code?: boolean; order?: number; hidden?: boolean }>;
        actions?: Record<string, false>;
      };
  /** A rounded, animated screen shown the first time the client app runs. `false` turns it off entirely. */
  welcome?:
    | false
    | {
        enabled?: boolean;
        /** A built-in icon name ('sparkles', 'rocket', …), SVG markup, or an https/data image URL. */
        icon?: string;
        /** `{name}` and `{version}` are replaced. */
        title?: string;
        subtitle?: string | null;
        steps?: Array<{ icon?: string; title: string; description?: string }>;
        actionLabel?: string;
        dismissible?: boolean;
        dismissLabel?: string;
      };
  /** Shown once after an update, when `entries` has something for the new version. `false` turns it off entirely. */
  whatsNew?:
    | false
    | {
        enabled?: boolean;
        icon?: string;
        /** `{name}` and `{version}` are replaced. */
        title?: string;
        subtitle?: string | null;
        entries?: Array<{ icon?: string; title: string; description?: string }>;
        actionLabel?: string;
        dismissible?: boolean;
        dismissLabel?: string | null;
      };
  badges?: {
    enabled?: boolean;
    sources?: Array<{ id: string; url: string; name?: string; refresh?: string | number; priority?: number }>;
    slots?: Record<string, boolean | Partial<Omit<BadgeSlot, 'userId'>>>;
    max?: number;
    cache?: { ttl?: string | number };
  };
  api?: {
    services?: Record<string, Omit<ServiceConfig, 'headers'> & { headers?: Record<string, string> }>;
    allowedOrigins?: string[];
  };
  host?: { selectors?: Record<string, string>; classes?: Record<string, string>; userSettingsLabel?: string; userIdProps?: string[] };
  desktop?: { csp?: 'leave' | 'relax'; devtools?: boolean; crashLimit?: number };
  web?: { userscript?: boolean; namespace?: string | null; updateURL?: string | null; downloadURL?: string | null; matches?: string[] | null };
  /** Read git information for the About page (default true). */
  git?: boolean;
  installer?: {
    preset?: 'minimal' | 'default' | 'showcase';
    /** An object, or a path to a JSON file with the same fields. */
    marketing?: MarketingConfig | string;
    target?: TargetConfig;
    closeApp?: 'ask' | 'always' | 'never';
    launchAfter?: boolean;
    zip?: boolean;
    gui?: boolean;
    /** The Windows setup .exe. */
    windows?: {
      /** Build it (default true; skipped when gui is false). */
      exe?: boolean;
      /** Default: <id>-<version>-setup.exe */
      fileName?: string | null;
      /** A PNG (at most 256 px) or .ico for the .exe; default: the config's icon. Needs a Windows build. */
      icon?: string | null;
      /** Shown in the file's properties; default: the authors. */
      company?: string | null;
      /** A signing command run on the finished .exe, with {file} replaced: 'signtool sign /fd sha256 /a {file}'. */
      sign?: string | null;
      /** Build a setup wizard with NSIS when makensis is found (default true), false for the browser launcher, or makensis's path. */
      nsis?: boolean | string;
      /** A 164×314 .bmp for the wizard's Welcome and Finish pages; default: the accent colour with the logo. */
      sidebar?: string | null;
      /** A 150×57 .bmp for the top of the wizard's other pages; default: the logo on white. */
      header?: string | null;
    };
  };
}

export declare function defineConfig(config: Config | ((env: { mode: string }) => Config | Promise<Config>)): typeof config;
export declare function loadConfig(options?: { cwd?: string; file?: string; overrides?: Config }): Promise<{ config: Required<Config> & Record<string, any>; root: string; file: string | null; warnings: string[]; packageJson: any }>;
export declare function validateConfig(config: Config, options?: { root?: string; file?: string }): { config: Required<Config> & Record<string, any>; warnings: string[] };
export declare class ConfigError extends Error {
  problems: string[];
}
export declare const CONFIG_FILES: string[];
export declare const configDefaults: Readonly<Config>;

export interface BuildResult {
  outDir: string;
  payloadDir: string;
  installerDir: string | null;
  zipFile: string | null;
  exeFile: string | null;
  userscriptFile: string | null;
  manifest: Record<string, any>;
  plugins: string[];
  themes: string[];
  files: string[];
  warnings: string[];
  ms: number;
}
export declare function build(config: Record<string, any>, options: { root: string; mode?: 'production' | 'development'; installer?: boolean; onStep?: (step: string) => void }): Promise<BuildResult>;
export declare function findPlugins(dirs: string[]): string[];
export declare function findThemes(dirs: string[]): string[];
/** Every `.svg` in the folders, keyed by file name, with the root `<svg>` size stripped. */
export declare function findIcons(dirs: string[]): Record<string, string>;
export declare function runtimeConfig(config: Record<string, any>): Record<string, any>;

export declare function pack(options: {
  entry: string;
  format?: 'function' | 'module';
  alias?: Record<string, string>;
  virtual?: Record<string, { code: string; dir: string }>;
  conditions?: string[];
  root?: string;
  urlPrefix?: string;
  check?: boolean;
}): { code: string; files: string[]; hash: string };
export declare class PackError extends Error {
  file?: string;
}

export interface GitInfo {
  commit: string;
  shortCommit: string;
  branch: string | null;
  tag: string | null;
  date: string | null;
  subject: string | null;
  dirty: boolean;
  remote: string | null;
  remoteURL: string | null;
  commitURL: string | null;
}
export declare function readGitInfo(cwd: string): GitInfo | null;
export declare function createZip(entries: Array<{ name: string; data: Buffer | string; mode?: number }>, out?: string): Buffer;
export declare function zipDirectory(dir: string, out?: string, options?: { prefix?: string; executable?: RegExp }): Buffer;

export type InstallState = 'clean' | 'installed' | 'needs-repair' | 'foreign' | 'missing';
export interface InstallStatus {
  state: InstallState;
  reason?: string;
  version?: string | null;
  stale?: boolean;
  resources: string;
  marker?: { id: string; name: string; version: string; framework: string; stubVersion: number; payloadDir: string; originalAsar: string; installedAt: string };
  stubVersion?: number;
}
export declare function inspect(resources: string, options?: { target?: TargetConfig }): InstallStatus;
export declare function findInstalls(options?: { target?: TargetConfig; platform?: NodeJS.Platform; env?: Record<string, string | undefined>; extra?: string[] }): Array<{ location: string; resources: string; executable: string | null; status: InstallStatus; fuses: ReturnType<typeof readFuses>; fuseCheck: { ok: boolean; reason: string | null } }>;
export declare function install(options: { resources: string; payload: string; target?: TargetConfig; dataDir?: string; force?: boolean; onStep?: (step: string) => void }): { resources: string; payloadDir: string; dataDir: string; marker: InstallStatus['marker']; appVersion: string; previous: InstallState };
export declare function uninstall(options: { resources: string; target?: TargetConfig; id?: string; purge?: boolean; dataDir?: string; onStep?: (step: string) => void }): { resources: string; removed: boolean; purged?: boolean; reason?: string };
export declare function repair(options: { resources: string; payload?: string; target?: TargetConfig; id?: string; dataDir?: string; onStep?: (step: string) => void }): Record<string, any>;
export declare class InstallError extends Error {
  code: string;
  hint: string | null;
}
export declare const STUB_VERSION: number;
export declare function readFuses(fileOrBuffer: string | Buffer): { version: number; fuses: Record<string, boolean | null> } | null;
export declare function checkFuses(result: ReturnType<typeof readFuses>): { ok: boolean; reason: string | null };
export declare function readAsarHeader(file: string): { header: any; base: number };
export declare function listAsarFiles(file: string): Array<{ path: string; size: number; offset: number | null; unpacked: boolean; executable: boolean }>;
export declare function readAsarFile(file: string, inner: string): Buffer | null;
export declare function createAsar(files: Record<string, Buffer | string>, out?: string): Buffer;
export declare function dataDir(id: string, options?: { platform?: NodeJS.Platform; env?: Record<string, string | undefined> }): string;
export declare const defaultTarget: Readonly<Required<TargetConfig>>;
export declare function renderInstallerPage(installer: Record<string, any>, options: { nonce: string }): string;
export declare const installerStrings: Readonly<Record<string, string>>;
export declare function parseMeta(source: string): { meta: Record<string, any>; vars: Array<Record<string, any>> };
export declare function canonicalText(source: string): string;
export declare function readSignature(source: string): { algorithm: string; keyId: string; value: string; canonical: string } | null;

// --- Developing one plugin (docs/plugin-development.md) -------------------------------------------

export declare const MANIFEST_FILE: 'yapin-plugin.json';

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  authors: Array<string | { name: string; url?: string }>;
  license?: string;
  website?: string;
  apiVersion?: number;
  minClientVersion?: string;
  platforms?: Array<'win32' | 'darwin' | 'linux' | 'web'>;
  tags?: string[];
  dependencies?: string[];
  conflicts?: string[];
  updateUrl?: string;
  entry?: string;
  outDir?: string;
  client?: string;
}

/** A validated manifest: paths resolved, lists filled in, authors parsed. */
export interface ResolvedPluginManifest extends PluginManifest {
  authors: Array<{ name: string; url?: string }>;
  apiVersion: number;
  platforms: Array<'win32' | 'darwin' | 'linux' | 'web'>;
  tags: string[];
  dependencies: string[];
  conflicts: string[];
  entry: string;
  outDir: string;
}

export declare class ManifestError extends Error {
  problems: string[];
}
export declare function definePluginManifest(manifest: PluginManifest): PluginManifest;
export declare function validateManifest(input: Record<string, any>, options?: { root?: string; file?: string | null }): { manifest: ResolvedPluginManifest; warnings: string[] };
export declare function loadManifest(options?: { cwd?: string; file?: string }): { manifest: ResolvedPluginManifest; root: string; file: string; warnings: string[] };

export interface PluginBuild {
  file: string;
  text: string;
  bytes: number;
  sha256: string;
  files: string[];
}
export declare function buildPlugin(manifest: ResolvedPluginManifest, options: { root: string; write?: boolean }): PluginBuild;
export declare function indexEntry(manifest: ResolvedPluginManifest, build: PluginBuild): Record<string, any>;
/** What `yapin.js-client/runtime` resolves to inside a user plugin. */
export declare const RUNTIME_SHIM: string;
export declare const SHIM_EXPORTS: string[];

export interface CheckResult {
  problems: string[];
  warnings: string[];
  meta: Record<string, any>;
  vars: Array<Record<string, any>>;
  signature: { algorithm: string; keyId: string; value: string; canonical: string } | null;
}
export declare function checkFile(file: string, text?: string, options?: { standalone?: boolean }): CheckResult;
export declare function checkAgainstManifest(manifest: ResolvedPluginManifest, text: string): string[];

export declare function formatHeader(manifest: ResolvedPluginManifest): string;
export declare function headerTags(manifest: ResolvedPluginManifest): Array<[string, string | number]>;
export declare function withSignature(text: string, signature: { algorithm: string; keyId: string; value: string }): string;

export declare const signatureAlgorithm: 'ed25519';
export declare function generateKeys(): { publicKey: string; privateKey: string };
export declare function signText(text: string, options: { keyId: string; privateKey: string }): string;
export declare function verifyText(text: string, keys?: Record<string, string>): { state: 'unsigned' | 'malformed' | 'unknown' | 'valid' | 'tampered'; keyId: string | null };

export declare function pluginsFolder(clientId: string): string;
export declare function installForDev(manifest: ResolvedPluginManifest, options: { root: string; clientId: string }): PluginBuild & { installed: string; folder: string };
export declare function uninstallForDev(id: string, clientId: string): boolean;
export declare function watchPlugin(manifest: ResolvedPluginManifest, options: { root: string; clientId: string; onBuild?: (result: PluginBuild & { installed: string; problems: string[]; warnings: string[] }) => void; onError?: (error: Error) => void; debounce?: number }): () => void;
