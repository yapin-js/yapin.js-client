# Security Policy

## Supported versions

Only the latest published `0.x` release of `yapin.js-client` on npm is supported with security fixes. There's no LTS branch yet at this stage.

## Reporting a vulnerability

Please **don't open a public GitHub issue** for a security vulnerability.

Instead, report it privately:

- Open a [GitHub security advisory](https://github.com/yapin-js/yapin.js-client/security/advisories/new) for this repository, or
- Email the maintainer at [christianjrelf@gmail.com](mailto:christianjrelf@gmail.com) with details.

Please include:

- The affected version and platform (Windows/macOS/Linux, desktop or web).
- Steps to reproduce, or a minimal client app that demonstrates the issue.
- The impact you think it has (e.g. escapes the native bridge's origin check, bypasses the plugin file allowlist, defeats the manifest hash check).

You should get a response within a few days. We'll agree on a disclosure timeline once the issue is confirmed, and credit you in the changelog unless you'd rather stay anonymous.

## Scope

This policy covers the `yapin.js-client` framework itself: the build pipeline, the installer, the desktop main-process shim and preload bridge, and the runtime.

It does not cover:

- Vulnerabilities in a specific client app built *with* the framework — report those to that app's own author.
- Vulnerabilities in the Yapin’ desktop app or web app itself — those aren't part of this project.

## What the framework already does

Before reporting a design question rather than a bug, see [docs/security.md](docs/security.md), which covers the native bridge's one-time claim, the main-process origin and file-path checks, the manifest hash check, network allowlisting, and how user plugins are handled.
