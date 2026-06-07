# CLAUDE.md

## Responsibilities

### Versioning and changelog

- **Auto-bump PATCH** — after every set of changes, bump the patch version in `wails.json` and print the new version at the end of the response.
- **Auto-update CHANGELOG** — add a new `## [x.y.z] — YYYY-MM-DD` entry to `docs/CHANGELOG.md` describing what changed. Keep entries concise (one line per item).
- **"NOT bump patch"** — if the user explicitly says not to bump, leave `wails.json` unchanged and amend the current version's CHANGELOG entry instead.
- **MINOR/MAJOR** — bump only when the user explicitly requests it.
