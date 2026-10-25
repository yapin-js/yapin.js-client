# Contributing

Thanks for considering a contribution to yapin.js-client.

## Setup

```sh
git clone https://github.com/yapin-js/yapin.js-client.git
cd yapin.js-client
npm test
```

There's nothing to install — the project has zero runtime dependencies, including its own bundler, asar reader/writer, zip writer and test runner.

## Making a change

1. Open an issue first for anything beyond a small fix, so the approach can be agreed on before you spend time on it.
2. Keep the zero-dependency rule: don't add a `dependencies` or `devDependencies` entry without discussing it first.
3. Add or update tests under `test/` for any behaviour change. `node --test test/*.test.js` (or `npm test`) must stay green.
4. If you touch `src/installer/windows/launcher.cs`, rebuild the prebuilt launcher on Windows with `npm run build:launcher` and commit the result.
5. Update the relevant file(s) in `docs/` when you change behaviour the docs describe.
6. Add an entry to `CHANGELOG.md` under an "Unreleased" heading.

## Pull requests

- Keep PRs focused on one change. Explain the *why*, not just the *what*, in the description.
- Match the existing code style (see `.editorconfig`); there's no separate linter to run.
- CI (`.github/workflows/ci.yml`) runs the test suite on every PR — make sure it's passing before requesting review.

## Reporting bugs

Open an issue with: what you expected, what happened, your OS/Node version, and (if it's a build or installer issue) the command you ran. A minimal repro client app helps a lot.

## Security issues

Don't open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md) instead.
