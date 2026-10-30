# Changelog

## [Unreleased]

### Added

- Declarative extension SQL payloads render the application namespace during installation; first setup renders Core starter definitions from the same configuration.

- Initial installation resolves the exact Core repository and commit through the schema-2 registry, using Git when available or a checksum-verified ZIP otherwise.
- Initial installation displays a Supacharger terminal banner and follows skill selection with a registry-backed extension checkbox preview that performs no download or installation.
- Interactive initialisation creates `.env.local` from Core's example, groups Supabase and Stripe credential prompts, and generates independent application signing secrets.
- Interactive initialisation prompts for the optional Supabase resource namespace before provider configuration and stores it only in `PROJECT_NAMESPACE`.
- `supacharger version` locates the nearest installed Core lock by walking up the directory tree and reports its registry release version.
- Interactive initialisation handles Ctrl+C without a stack trace and states whether Core was already installed when setup stopped.
- `supacharger extension available` presents a numbered registry list, marks installed extensions and offers interactive selection; `extension list` remains an alias.

### Changed

- Initialisation now reports seven numbered stages in purple, explains destructive replacement in plain language, accepts explicit `Y` or `n`, and removes the development-only GitHub warning.
- Initialisation now reports namespace-version incompatibility and unexpected failures without exposing internal stack traces.
- Extension install and update commands now read the schema-2 registry manifest and its per-extension descriptors. Extensions without published release metadata remain explicitly registered but unverified during local-source review.
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
