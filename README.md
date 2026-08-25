# supacharger-cli

Developer CLI for installing and safely updating Supacharger applications.

`supacharger init [target]` installs the starter, including starter `next-intl` configuration and message catalogues. After installation, each application owns `src/i18n/config.ts`, `src/i18n/request.ts`, and the complete `messages/` directory.

`supacharger coreupdate` checks protected core files against the installed baseline, but excludes localisation paths from integrity conflicts. It preserves locale configuration and every secondary catalogue. For `messages/en.json`, it adds missing canonical keys and fills empty English values while retaining every existing non-empty application value, so new managed routes cannot fail because an older project lacks their source copy.

`supacharger doctor` is read-only. It checks the Next.js Proxy entry point, the claims-only database-free Proxy helper, all three protected server-access boundaries, enabled onboarding and billing recovery destinations, canonical account/organisation configuration, managed organisation routes/tests/adapters, duplicate App Router pages after route-group normalisation, required English namespaces, obsolete `/auth/*` and `/organisation` pages, the ownership manifest, required scripts and Bruno assets, Supabase dependencies, hook configuration, local TOTP enrol/verify capability, migrations and aliases, and public environment-variable names. It also fails when the preserved configuration still declares obsolete billing-gate properties or `MFA_TOTP.ENABLED`. A configured setup page fails if it inherits `requireOnboardedUser()` or `requireAppAccess()`; a configured acquisition page fails if it inherits `requireAppAccess()`. The command never prints values, rewrites developer configuration, contacts a linked project, changes routes, or changes a database.

## Managed core updates

The canonical core publishes version 2 of `.supacharger/managed-files.json`. It separates byte-identical `managedPaths`, contract-aware `mergeManagedPaths`, append-only `forwardOnlyMigrationPaths`, and preserved `developerOwnedPaths`. Reusable authentication/account routes live under `src/app/(supacharger)/`; product routes under `src/app/(project)/`, translations, project CSS, and `src/supacharger.adapters/` remain developer-owned.

When managed public authentication routes replace unchanged legacy wrappers under `src/app/(project)/(unauthenticated)/account`, `coreupdate` backs up and removes those wrappers before installing the canonical routes. It stops if a wrapper differs from the installed Core baseline so product behaviour cannot be discarded. The update installs developer-owned auth, account, billing, and organisation adapter starters only when each file is missing; established product presentation and integrations are preserved on every later update. Managed authentication, account, and organisation JSX uses semantic hooks whose complete presentation belongs in the preserved `src/styles/supacharger-auth.css`, `src/styles/supacharger-account.css`, and `src/styles/supacharger-organisations.css` files. Organisation adapters include the page, navigation, chrome, and profile extension seams under `src/supacharger.adapters/organisations/`.

The developer-owned inline loader variants at `src/assets/svgr/ui/inline-loader.svg` and `src/assets/svgr/ui/inline-loader-dark.svg` are also preserved. An update installs either starter only when that exact path is absent, so it cannot overwrite application branding.

Protected Supabase Proxy code is installed at `src/lib/supabase/supacharger/proxy.ts`, protected application access at `src/supacharger/auth/server-access.ts`, and provider SVG components at `src/supacharger/assets/svgr/auth-providers/`. `coreupdate` removes obsolete protected paths declared by the installed baseline while preserving developer-owned loader artwork. During this alignment it also removes the old `AUTH_SESSION.VERIFICATION_MODE` property: `getClaims()` is now the fixed Proxy invariant.

Authenticator-app management is always available in Account Security. During this alignment, `coreupdate` removes obsolete `AUTHENTICATION.MFA_TOTP.ENABLED`, preserves `REQUIRED_FOR_SIGN_IN`, and enables both local `[auth.mfa.totp]` enrolment and verification APIs. Restart the local Supabase stack after updating. Hosted MFA capability remains a separate Dashboard setting.

Core updates distribute `requireVerifiedUser()`, `requireOnboardedUser()`, and `requireAppAccess()`, but recovery pages remain developer-owned and are never moved automatically. After adopting the three-level access contract, manually place profile setup beneath a verified-only layout and billing acquisition beneath an onboarded-only layout, keeping their public URLs unchanged. Leave full product routes beneath `requireAppAccess()`, then run `supacharger doctor` to detect a missing destination or incompatible canonical ancestry.

`supacharger init` installs the complete `src/app/layout.tsx` starter. The manifest then classifies that file as a developer-owned template, so `coreupdate` preserves application fonts, providers, body classes, and extra head content. Shared metadata, SEO, viewport, favicon, and analytics fixes continue through the managed `src/supacharger/root-document.tsx` helper.

```bash
supacharger coreupdate --plan --ref <tag-or-commit>
supacharger coreupdate --ref <tag-or-commit>

# Maintainers may plan from a clean local Core checkout:
supacharger coreupdate --plan --source ../supacharger
```

`--plan` clones the installed baseline and latest core into an operating-system temporary directory, then reports writes, obsolete managed removals, dependency changes, migrations, and post-update checks without changing the application or a database.

A real update checks baseline integrity, backs up overwritten files under `.supacharger/backups/<timestamp>/`, byte-replaces only exact managed paths, removes obsolete exact files, merges Core dependency requirements and missing required scripts without discarding product dependencies/scripts, and regenerates the package lock when dependencies change. If Core changes a merge-managed file without an implemented strategy, the CLI stops and names the file for an explicit migration instead of claiming completion. Shared managed contract tests contain only reusable Core assertions; product billing assertions belong in the preserved `test/project-billing-schema-contract.test.mjs` seam and may be added to the consumer's package test script. The CLI copies only new Core migrations; a differing migration with the same filename halts as a conflict, and installed histories are never replaced or removed. A consumer that already has a reviewed adapted equivalent under another immutable filename records the exact mapping in developer-owned `.supacharger/migration-aliases.json`; `--plan` reports it and update validates the target before skipping the canonical file. Linked migrations are shown through `supabase db push --linked --dry-run`; the separate confirmation explicitly applies every pending migration shown there, including consumer-owned migrations. The CLI verifies the linked ledger, runs every declared manifest check, re-hashes every exact managed file against the target commit, and advances `.supacharger/core-lock.json` only after all checks succeed. The managed Bruno collection/checker therefore blocks a lock advance when canonical RPC parity fails. File backups do not replace an environment-appropriate database backup.

`postcss.config.mjs` is exact managed. During an upgrade from the legacy filename, an unchanged `postcss.config.js` is backed up and removed; a customised legacy file is preserved and the update stops for human review.

Application values in `src/supacharger.config.ts` are also preserved. The updater distributes the protected `src/supacharger/supacharger-config-contract.ts`, so every application is checked against the same option names and shapes while retaining its own values. The approved account-alignment migration inserts only absent profile-media, `ACCOUNT_SETTINGS`, `ORGANISATIONS`, and `BILLING.ACCOUNT_SUBJECTS` keys with disabled-safe defaults; it never replaces an existing value.

The current contract renames the historical `PATH_AUTH_GARD` option to `PATH_AUTH_GUARD`. Rename the key in an existing application's `src/supacharger.config.ts` before adopting this core version.

The social-auth provider migration expands `AUTH_PROVDERS_ENABLED` from Google/Facebook to the complete canonical Supabase provider map. `coreupdate --plan` lists every missing nested key. A real update backs up `src/supacharger.config.ts`, preserves existing provider values, and adds every newly supported provider as `false`; developers opt in only after configuring that provider and `/auth/callback` in Supabase.

The root-document migration similarly reports missing `METADATA`, `ROOT_PROVIDERS`, and `ANALYTICS` blocks. A real update backs up the developer configuration and inserts only missing blocks. It derives the title template from the existing application title, enables favicon declarations only when `public/favicon.ico` and the standard `public/favicons/` files exist, and leaves Google Analytics disabled until `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is configured.

Read the documentation at http://supacharger.dev/docs/cli/
