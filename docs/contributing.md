# Contributor guide

[Back to the README](../README.md)

This page covers work on the CLI and its distribution rules. Application developers can start with [Getting started](getting-started.md).

Read this repository's `AGENTS.md` and `.agents/project/AGENTS.md` before changing code. The CLI owns its unit tests; do not distribute them to application starters or include them in the published package.

## Check a local change

```bash
npm ci
npm run check
```

The check command checks TypeScript types, runs the CLI tests and builds the executable. Use `node dist/bin/cli.js --help` after building to inspect the local commands without changing a project. Run installation or update experiments only against an appropriate disposable test application.

Edit the TypeScript files in `bin/`, `commands/` and `test/`. Files ending in `.cts` explicitly produce CommonJS modules (`.cjs`). `npm run build` creates the JavaScript in `dist/`; do not edit or commit that generated directory. `npm run typecheck` checks types without building, and `npm test` compiles the tests into the ignored `.test-dist/` directory before running them.

`npm pack` and `npm publish` build the executable automatically through `prepack`. The published package contains compiled JavaScript and its required JSON files, excluding test code and TypeScript development files. Users install and run it with the same npm and `supacharger` commands; they do not need a separate compilation step. TypeScript remains a runtime dependency because the CLI uses its parser to read application configuration safely.

The `files` list in `package.json` controls the published package. The README uses GitHub-hosted image and guide links so npm readers can reach the documentation without adding those assets to the executable package.

Changes on GitHub do not automatically update the npm release. Check `supacharger --version` when investigating a user's installed behaviour, and distinguish published features from entries under **Unreleased** in the changelog.

## Optional Core contributor instructions

Contributors with access to the private instruction repository can run these commands from a Git-based Supacharger project:

```bash
supacharger coredev install
supacharger coredev update
```

Installation creates a separate checkout at `.agents/supacharger/core-development/` and excludes it locally through the parent repository's `.git/info/exclude`. It is not a submodule. Updating refuses local changes and advances the configured branch only when no merge is needed.

These instructions are not installed by ordinary application setup, Core updates, diagnosis or skills installation. They are optional contributor tooling, not an application dependency.

To review Core from a local checkout:

```bash
supacharger coreupdate --plan --source /path/to/supacharger
```

The source commit must be a registered release. Do not describe an arbitrary local branch as a supported update target. Plans use temporary comparison directories; they do not author or publish changes from those directories.

## Shared installers

Core owns these reusable installer implementations. Keep the CLI copies byte-identical when changing them:

| Core source | CLI copy |
| --- | --- |
| `tools/supacharger-skills/installer.cts` | `commands/skills/installer.cts` |
| `tools/supacharger-extensions/installer.cts` | `commands/extensions/installer.cts` |

Edit the TypeScript source in Core first, then copy it to the CLI. Core's [shared installer build](https://github.com/glowplug-studio/supacharger/blob/main/tools/supacharger-skills/README.md#building-the-shared-installers) regenerates its checked-in CommonJS files for existing tooling. The CLI's `npm run build` generates the same files under `dist/commands/skills/` and `dist/commands/extensions/`. Compare both source pairs and generated file pairs before releasing; use the same pinned TypeScript compiler and emit settings in both repositories.

Preserve source provenance, local-edit protection and the separation between Core, application-owned files and migration history. Do not make a CLI-only change to a shared installer without aligning its canonical source.

## Extension bundles

Schema-3 extension bundles describe how their files map into an application:

| Bundle path | Application destination |
| --- | --- |
| `payload/app/` | `src/app/(project)/(extensions)/(sc_extensions)/(<id>)/` |
| `payload/supabase/shared/` | `supabase/functions/_shared/extensions/sc_ext-<id>/` |
| Namespaced function payloads | `supabase/functions/` |
| Forward SQL migrations | `supabase/migrations/` |
| `payload/docs/` | `docs/extensions/<id>/`; must include `INSTALL.md`. |

The manifest name is `supacharger-ext-<id>`. Mark the app-root `supacharger-ext-<id>.config.ts` file with `kind: config` so an existing application configuration is preserved. Source and target paths must follow the supported mapping.

The registry uses a schema-2 manifest with separate Core and extension descriptors. A downloadable extension release needs a version, exact source commit, GitHub ZIP URL and SHA-256 checksum. The archive must contain one root folder with `extension.json` and its payload. Review local bundles with `--source` and `--plan` before publishing them.

File installation is separate from configuration, database application and deployment. Do not treat matching files or an installed marker as evidence that the feature works in production. See [Extensions](extensions.md) for the application-facing workflow.
