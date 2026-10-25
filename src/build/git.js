import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true }).trim();
  } catch {
    return null;
  }
}

/** Turns git@github.com:o/r.git or https://user:token@host/o/r.git into a browsable https URL, without credentials. */
export function remoteToURL(remote) {
  if (!remote) return null;
  let url = remote.trim().replace(/\.git$/, '');
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(url);
  if (scp) url = `https://${scp[1]}/${scp[2]}`;
  url = url.replace(/^ssh:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\//, 'https://$1/').replace(/^git:\/\//, 'https://');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.username = '';
    parsed.password = '';
    parsed.protocol = 'https:';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Where a commit can be viewed, for the hosts that agree on /commit/<sha>. */
export function commitURL(remoteURL, commit) {
  if (!remoteURL || !commit) return null;
  const host = new URL(remoteURL).hostname;
  if (/github\.com$|gitea|codeberg\.org$/.test(host)) return `${remoteURL}/commit/${commit}`;
  if (/gitlab/.test(host)) return `${remoteURL}/-/commit/${commit}`;
  if (/bitbucket\.org$/.test(host)) return `${remoteURL}/commits/${commit}`;
  return null;
}

/**
 * Information about the source the client app was built from, for its About page. null when the
 * project isn't a git repository or git isn't installed. Credentials in the remote URL are removed.
 */
export function readGitInfo(cwd) {
  const commit = git(cwd, ['rev-parse', 'HEAD']);
  if (!commit) return null;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const tag = git(cwd, ['describe', '--tags', '--exact-match']);
  const date = git(cwd, ['log', '-1', '--format=%cI']);
  const subject = git(cwd, ['log', '-1', '--format=%s']);
  const status = git(cwd, ['status', '--porcelain']);
  const remoteName = git(cwd, ['config', '--get', `branch.${branch}.remote`]) || 'origin';
  const remoteURL = remoteToURL(git(cwd, ['remote', 'get-url', remoteName]));
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    branch: branch === 'HEAD' ? null : branch,
    tag: tag || null,
    date: date || null,
    subject: subject || null,
    dirty: Boolean(status),
    remote: remoteURL ? remoteURL.replace(/^https:\/\//, '') : null,
    remoteURL,
    commitURL: commitURL(remoteURL, commit),
  };
}
