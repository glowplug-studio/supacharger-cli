# supacharger-cli

Developer CLI for installing and safely updating Supacharger applications.

Commands print a yellow demonstration warning before `init`, remote `coreupdate`, `doctor` and `coredev` contact private development repositories on GitHub. Public-skills operations and local `--source` comparisons do not print it.

`supacharger init [target]` installs the starter, including starter `next-intl` configuration and message catalogues. After installation, each application owns `src/i18n/config.ts`, `src/i18n/request.ts`, and the complete `messages/` directory.

`supacharger coreupdate` checks protected core files against the installed baseline, but excludes localisation paths from integrity conflicts. It preserves locale configuration and every secondary catalogue. For `messages/en.json`, it adds missing canonical keys and fills empty English values while retaining every existing non-empty application value, so new managed routes cannot fail because an older project lacks their source copy.

`supacharger doctor` is read-only. It downloads the Core revision recorded in `.supacharger/core-lock.json` and the requested incoming revision, then compares their managed files directly with the project. It reports local modifications or missing files separately from incoming additions, updates and removals. It also compares property names in the developer-owned `src/supacharger.config.ts` with the incoming Core template. It stores no file hashes, changes no project files and contacts no database.

## Optional Core contributor instructions

These private instructions are inert and absent from ordinary application use. They are not installed by `init`, `coreupdate`, `doctor`, `skills`, or a normal non-recursive clone.

Run these commands explicitly from a Git-based Supacharger project only when contributing to Core:

```bash
supacharger coredev install
supacharger coredev update
```

`install` registers or initialises `.agents/supacharger/core-development/` from the private contributor repository over SSH. `update` refuses local submodule changes, then checks out the latest configured remote branch. Review and commit `.gitmodules` and the submodule reference when the parent repository should retain them. A recursive Git clone may initialise an already committed submodule without invoking the CLI.

## Managed core updates

The canonical core publishes version 2 of `.supacharger/managed-files.json`. It separates byte-identical `managedPaths`, contract-aware `mergeManagedPaths`, append-only `forwardOnlyMigrationPaths`, and preserved `developerOwnedPaths`. Reusable authentication/account routes live under `src/app/(supacharger)/`; product routes under `src/app/(project)/`, translations, project CSS, and `src/supacharger.adapters/` remain developer-owned.

`tailwind.config.ts` is exact Core-managed and imports the blank developer-owned `tailwind.project.config.ts` preset. Updates install that preset only when absent; project-specific Tailwind configuration belongs there. When upgrading from the former merge-managed ownership, the CLI stops if the root Tailwind file contains project changes so they can be moved into the preset before replacement.

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
supacharger coreupdate --plan --source ../SUPACHARGER_APPS/supacharger
```

`--plan` clones the installed baseline and latest Core into an operating-system temporary directory, then reports writes, obsolete managed removals, dependency changes and migrations without changing the application or a database.

A real update compares the project directly with the installed Core revision, backs up overwritten files under `.supacharger/backups/<timestamp>/`, byte-replaces only exact managed paths, removes obsolete exact files, merges Core dependency requirements without discarding product dependencies, and regenerates the package lock when dependencies change. If Core changes a merge-managed file without an implemented strategy, the CLI stops and names the file for an explicit migration. The CLI copies only new Core migrations; a differing migration with the same filename halts as a conflict, and installed histories are never replaced or removed. A reviewed adapted equivalent may be mapped in developer-owned `.supacharger/migration-aliases.json`. Linked migrations retain their separate preview and confirmation. Finally, the CLI directly compares every installed managed file with the downloaded target and advances `.supacharger/core-lock.json` only when they match. It stores no file hashes and runs no application test suite.

`postcss.config.mjs` is exact managed. During an upgrade from the legacy filename, an unchanged `postcss.config.js` is backed up and removed; a customised legacy file is preserved and the update stops for human review.

Application values in `src/supacharger.config.ts` are also preserved. The updater distributes the protected `src/supacharger/supacharger-config-contract.ts`, so every application is checked against the same option names and shapes while retaining its own values. The approved account-alignment migration inserts only absent profile-media, `ACCOUNT_SETTINGS`, `ORGANISATIONS`, and `BILLING.ACCOUNT_SUBJECTS` keys with disabled-safe defaults; it never replaces an existing value.

The current contract renames the historical `PATH_AUTH_GARD` option to `PATH_AUTH_GUARD`. Rename the key in an existing application's `src/supacharger.config.ts` before adopting this core version.

The social-auth provider migration expands `AUTH_PROVDERS_ENABLED` from Google/Facebook to the complete canonical Supabase provider map. `coreupdate --plan` lists every missing nested key. A real update backs up `src/supacharger.config.ts`, preserves existing provider values, and adds every newly supported provider as `false`; developers opt in only after configuring that provider and `/auth/callback` in Supabase.

The root-document migration similarly reports missing `METADATA`, `ROOT_PROVIDERS`, and `ANALYTICS` blocks. A real update backs up the developer configuration and inserts only missing blocks. It derives the title template from the existing application title, enables favicon declarations only when `public/favicon.ico` and the standard `public/favicons/` files exist, and leaves Google Analytics disabled until `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is configured.

Read the documentation at http://supacharger.dev/docs/cli/

Core upgrades install the no-op `src/supacharger.adapters/request-guard.ts` only when absent, preserving project availability checks on later updates.

## Signup terms notice

Set `AUTHENTICATION.SIGN_UP_TERMS_URL` in developer-owned `src/supacharger.config.ts` to an absolute HTTP(S) URL. The default `null` hides the notice; invalid, relative and credential-bearing URLs are not rendered. The link opens a new tab with `noopener noreferrer`.

The shared login/signup form displays the notice beneath signup actions and on the provider chooser, where a social action can create an account even from sign-in. Wording follows the configured password, passwordless and social signup methods. `AuthJourney.signUpTerms`, `signUpTermsSocial`, `signUpTermsSocialOnly`, `signUpTermsPasswordless` and `signUpTermsPasswordlessSocial` are complete rich-text messages; preserve the `<terms>...</terms>` link tag when translating. English values are supplied; secondary catalogues remain pending translation.

This is a displayed notice, not a required checkbox or stored consent record. `ACCOUNT_REQUIRED_TERMS_AGREEMENT_PATH` remains separate. CLI upgrades add the missing setting as `null` and preserve an existing URL. Existing consumers receive the same property without changing their authentication methods. Configure the application's real terms URL before expecting a visible notice.

## Git update identity and image loader

A Git update resolves the requested ref once and fetches that commit, even if the branch moves while conflicts are reviewed. Both update paths record the checked-out commit only after direct managed-file comparison succeeds. Use an explicit commit SHA for a separately reviewed plan and update to target the same release.

The updater installs `src/assets/svgr/ui/image-loader.svg` only when absent and preserves existing artwork, including during legacy updates without a manifest. These CLI changes must be published before they are available through npm.

## Free public agent skills

This feature downloads selected skills from the public `glowplug-studio/glowplug-skills` GitHub repository over HTTPS; no purchase or token is required.

```bash
supacharger skills install
supacharger skills install general/changelog
supacharger skills update general/changelog
supacharger skills update
supacharger skills install general/changelog --ref <commit-or-tag>
supacharger init my-project --skip-skills
```

Without identifiers, install/update presents grouped checkboxes with descriptions and installation status. An empty selection skips. Named identifiers support agents and non-interactive terminals; non-interactive calls without identifiers fail clearly. Interactive initialisation offers installation after creating the starter; an optional skills failure does not undo initialisation.

Complete skill folders are installed at `.agents/skills/<name>/`, with immutable source commits and SHA-256 file hashes in `.supacharger/skills-lock.json`. Commit these together. Existing untracked destinations and local edits are refused; unchanged installations are idempotent. Skill updates require the explicit update command and do not advance the Core lock. Downloaded skill scripts are not executed. A killed installer may leave `.supacharger/skills-install.lock` and `skills-transaction-*` recovery data; inspect them before retrying.

Maintainers can test committed local source with `--source /path/to/glowplug-skills`. Uncommitted source changes are not exported. Publish recorded catalogue commits before expecting remote installs to retrieve them. This command set must be released to npm before older globally installed CLIs can use it.

The canonical installer is Core's `tools/supacharger-skills/installer.cjs`, copied byte-identically into `commands/skills/installer.cjs`. Keep both copies and their tests aligned. Root `AGENTS.md`, `.agents/project/AGENTS.md` and `CHANGELOG.project.md` are installed only when missing during Core updates; existing project instructions are preserved. Shared `.agents/supacharger/guidance.md` and `CHANGELOG.md` follow Core's exact-managed manifest.

See [Agent guidance](https://supacharger.dev/docs/agents), [Skills](https://supacharger.dev/docs/skills) and [Contributing](https://supacharger.dev/docs/contributing).

The public skill checkbox dependency requires Node.js 22.13 or later in the 22.x line, or Node.js 24 or later.
