# Changelog

## [Unreleased]

### Added

- `supacharger nuke -u <UUID>` previews and queues an application's account-deletion policy through a separate administrator credential, explicit application origin and UUID confirmation. It reports the job reference without claiming cleanup has completed, and refuses redirects or non-loopback HTTP targets.

- Explicit `init --namespace` selection and default `sc_` preparation now run before environment prompts, including non-interactive installation. Fresh starters receive a verified namespaced initial migration.
- Declarative Core updates merge upstream and application definitions and generate a project-specific migration, preserving installed history and retaining unfinished update checksums until deployment is verified. Conflicts and unclassified data upgrades stop for review.

- Declarative extension SQL payloads render the application namespace during installation; first setup renders Core starter definitions from the same configuration.

- Initial installation resolves the exact Core repository and commit through the schema-2 registry, using Git when available or a checksum-verified ZIP otherwise.
- Initial installation displays a Supacharger terminal banner and follows skill selection with a registry-backed transactional-email installer.
- Interactive initialisation creates `.env.local` from Core's example, groups Supabase and Stripe credential prompts, and generates independent application signing secrets.
- Interactive initialisation prompts for the optional Supabase resource namespace before provider configuration and stores it only in `PROJECT_NAMESPACE`.
- `supacharger which --core` locates the nearest installed Core lock and `supacharger which --extension <name>` reports a published registry version.
- Interactive initialisation handles Ctrl+C without a stack trace and states whether Core was already installed when setup stopped.
- `supacharger extension available` presents a numbered registry list, marks installed extensions and offers interactive selection; `extension list` remains an alias.
- Interactive initialisation can install application packages and optionally run Stripe's official `stripe agent setup` flow when Stripe CLI is already installed.
- Extension install, update and doctor commands can download checksum-verified published release archives when no reviewed local source is supplied.

### Changed

- CLI commands and regression tests use strict TypeScript. Publishing builds the JavaScript executable automatically, while tests and development files stay outside the npm package.

- Existing `.env.local` files preserve their secrets without skipping namespace rendering.

- Initialisation now reports seven numbered stages in purple, explains destructive replacement in plain language, accepts explicit `Y` or `n`, and removes the development-only GitHub warning.
- Initialisation now reports namespace-version incompatibility and unexpected failures without exposing internal stack traces.
- Extension install and update commands now read the schema-2 registry manifest and its per-extension descriptors. Extensions without published release metadata remain explicitly registered but unverified during local-source review.
- `supacharger doctor --extension <name>` and `extension doctor <name>` now share the same registry-backed comparison flow.
- Core updates migrate the previous canonical organisation chooser and route-mode values to `/organisation/choose` and `organisation-handle`, including preview and recovery-copy handling. Developer-owned navigation and return URLs require manual alignment.

## [1.1.0] - 2026-09-14

### Added

- Public skill installation and explicit private Core-contributor setup commands.
- Manifest-based exact, merge-managed, developer-owned, and forward-only update boundaries.
- Read-only Core diagnosis against the installed and incoming revisions.

### Changed

- Initialisation now prepares Core before replacing target contents and restores the target after installation failure.
- Core updates block incoming managed-path collisions and unsupported automatic merge changes.
- Configuration diagnosis now parses exact nested paths with TypeScript.
- Recovery copies are stored under `.supacharger/backups/` and excluded through the local Git repository.
- Node.js 22.13 or later in the 22.x line, or Node.js 24 or later, is required.

### Removed

- Core and consumer application regression suites from CLI distribution.
