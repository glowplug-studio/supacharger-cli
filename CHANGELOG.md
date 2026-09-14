# Changelog

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
