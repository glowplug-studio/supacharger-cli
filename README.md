# supacharger-cli

Developer CLI for installing and safely updating Supacharger applications.

`supacharger init [target]` installs the starter, including starter `next-intl` configuration and message catalogues. After installation, each application owns `src/i18n/config.ts`, `src/i18n/request.ts`, and the complete `messages/` directory.

`supacharger coreupdate` checks protected core files against the installed baseline, but excludes those localisation paths from integrity conflicts and preserves them during every overwrite mode. If `messages/` already exists, the updater does not add, replace, or delete individual locale files. Core release notes and the Supacharger localisation guide identify any translation keys that applications must add manually.

`supacharger doctor` is read-only. It checks the Next.js Proxy entry point, the claims-only database-free Proxy helper, all three protected server-access boundaries, enabled onboarding and billing recovery destinations, canonical auth/session/route/profile/onboarding/organisation options, the managed-file manifest, required post-update scripts and Bruno assets, Supabase dependencies, hook configuration, migrations, and public environment-variable names. A configured setup page fails the check if it inherits `requireOnboardedUser()` or `requireAppAccess()`; a configured acquisition page fails if it inherits `requireAppAccess()`. The command never prints values, contacts a linked project, changes routes, or changes a database.

## Managed core updates

The canonical core publishes version 2 of `.supacharger/managed-files.json`. It separates byte-identical `managedPaths`, contract-aware `mergeManagedPaths`, append-only `forwardOnlyMigrationPaths`, and preserved `developerOwnedPaths`. Product/account routes under `src/app/(project)/`, presentation, translations, project CSS, and `src/supacharger.adapters/` remain developer-owned.

The developer-owned inline loader variants at `src/assets/svgr/ui/inline-loader.svg` and `src/assets/svgr/ui/inline-loader-dark.svg` are also preserved. An update installs either starter only when that exact path is absent, so it cannot overwrite application branding.

Protected Supabase Proxy code is installed at `src/lib/supabase/supacharger/proxy.ts`, protected application access at `src/supacharger/auth/server-access.ts`, and provider SVG components at `src/supacharger/assets/svgr/auth-providers/`. `coreupdate` removes obsolete protected paths declared by the installed baseline while preserving developer-owned loader artwork. During this alignment it also removes the old `AUTH_SESSION.VERIFICATION_MODE` property: `getClaims()` is now the fixed Proxy invariant.

Core updates distribute `requireVerifiedUser()`, `requireOnboardedUser()`, and `requireAppAccess()`, but recovery pages remain developer-owned and are never moved automatically. After adopting the three-level access contract, manually place profile setup beneath a verified-only layout and billing acquisition beneath an onboarded-only layout, keeping their public URLs unchanged. Leave full product routes beneath `requireAppAccess()`, then run `supacharger doctor` to detect a missing destination or incompatible canonical ancestry.

`supacharger init` installs the complete `src/app/layout.tsx` starter. The manifest then classifies that file as a developer-owned template, so `coreupdate` preserves application fonts, providers, body classes, and extra head content. Shared metadata, SEO, viewport, favicon, and analytics fixes continue through the managed `src/supacharger/root-document.tsx` helper.

```bash
supacharger coreupdate --plan
supacharger coreupdate
```

`--plan` clones the installed baseline and latest core into an operating-system temporary directory, then reports writes, obsolete managed removals, dependency changes, migrations, and post-update checks without changing the application or a database.

A real update checks baseline integrity, backs up overwritten files under `.supacharger/backups/<timestamp>/`, byte-replaces only exact managed paths, removes obsolete exact files, merges Core dependency requirements and missing required scripts without discarding product dependencies/scripts, and regenerates the package lock when dependencies change. If Core changes a merge-managed file without an implemented strategy, the CLI stops and names the file for an explicit migration instead of claiming completion. Shared managed contract tests contain only reusable Core assertions; product billing assertions belong in the preserved `test/project-billing-schema-contract.test.mjs` seam and may be added to the consumer's package test script. The CLI copies only new Core migrations; a differing migration with the same filename halts as a conflict, and installed histories are never replaced or removed. Linked migrations are shown through `supabase db push --linked --dry-run`; the separate confirmation explicitly applies every pending migration shown there, including consumer-owned migrations. The CLI verifies the linked ledger, runs every declared manifest check, re-hashes every exact managed file against the target commit, and advances `.supacharger/core-lock.json` only after all checks succeed. The managed Bruno collection/checker therefore blocks a lock advance when canonical RPC parity fails. File backups do not replace an environment-appropriate database backup.

`postcss.config.mjs` is exact managed. During an upgrade from the legacy filename, an unchanged `postcss.config.js` is backed up and removed; a customised legacy file is preserved and the update stops for human review.

Application values in `src/supacharger.config.ts` are also preserved. The updater distributes the protected `src/supacharger/supacharger-config-contract.ts`, so every application is checked against the same option names and shapes while retaining its own values. A release that changes the contract must include explicit configuration migration instructions.

The current contract renames the historical `PATH_AUTH_GARD` option to `PATH_AUTH_GUARD`. Rename the key in an existing application's `src/supacharger.config.ts` before adopting this core version.

The social-auth provider migration expands `AUTH_PROVDERS_ENABLED` from Google/Facebook to the complete canonical Supabase provider map. `coreupdate --plan` lists every missing nested key. A real update backs up `src/supacharger.config.ts`, preserves existing provider values, and adds every newly supported provider as `false`; developers opt in only after configuring that provider and `/auth/callback` in Supabase.

The root-document migration similarly reports missing `METADATA`, `ROOT_PROVIDERS`, and `ANALYTICS` blocks. A real update backs up the developer configuration and inserts only missing blocks. It derives the title template from the existing application title, enables favicon declarations only when `public/favicon.ico` and the standard `public/favicons/` files exist, and leaves Google Analytics disabled until `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is configured.

Read the documentation at http://supacharger.dev/docs/cli/
