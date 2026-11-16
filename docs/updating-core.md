# Updating Core

[Back to the README](../README.md)

A Core update brings shared Supacharger improvements into your application while preserving the files that belong to your product. Run these commands from the application folder. This guide follows the current source; check your installed CLI's help and the [changelog](../CHANGELOG.md) for release availability.

## Check before changing anything

Save your work in Git, then run:

```bash
supacharger which --core
supacharger doctor
supacharger coreupdate --plan
```

`which --core` prints the installed Core version. `doctor` compares your shared files with the version you installed and the incoming release. It also checks the names and structure of your configuration settings. It reports missing files, local edits and incoming changes separately.

`doctor` does not change the application or contact a database. If it cannot understand a dynamically generated configuration, it reports that the inspection is incomplete. It is not a deployment or database-health check.

`coreupdate --plan` lists proposed file changes, package changes and database work without applying them. For the current database format, it reports SQL definitions to merge; it does not generate the final migration or deploy it during the preview.

## Apply a reviewed update

```bash
supacharger coreupdate
```

The command asks before proceeding. By default it uses the current registered release. To review and install the same specific release, pass its registered version, tag or full commit to both commands:

```bash
supacharger coreupdate --plan --ref <registered-version-tag-or-commit>
supacharger coreupdate --ref <registered-version-tag-or-commit>
```

A commit is an exact saved revision of the source. Unregistered branches and commits are rejected. The installed version record advances only after the required update steps and shared-file checks finish successfully.

## What changes and what stays yours

The rules are recorded in `.supacharger/managed-files.json`:

| File group | What an update does |
| --- | --- |
| `managedPaths` | Replaces shared files with the exact Core version. Local changes are reported for review. Obsolete shared files can be removed. |
| `mergeManagedPaths` | Combines only supported changes, such as dependency updates. It stops when a change needs a manual decision. |
| `forwardOnlyMigrationPaths` | Preserves the database's existing migration history. A migration is a saved SQL change applied in order. |
| `developerOwnedPaths` | Preserves product code, branding, application settings and other custom work. Some starter files are added only when missing. |

Your product routes, adapters, translation settings and secondary-language files stay yours. For English messages, updates add missing Core keys and fill empty values without replacing existing non-empty wording.

Before replacing files, the CLI saves recovery copies in `.supacharger/backups/<timestamp>/`. It excludes that directory from Git locally. New Core files that would collide with existing project files stop the update for review.

Package updates preserve application identity, product dependencies and non-test scripts. The package lock is regenerated when the dependency settings change. Unsupported script or configuration merges stop rather than guessing how your application should work. See [Configuration and upgrade notes](upgrade-notes.md) for specific file changes.

## Database changes need a separate review

The current source supports two database update paths:

- **Core with declarative SQL:** the files describe the database structure you want. The CLI combines incoming Core definitions with your application's definitions and generates a new migration for your project. It does not replace your history with Core's migration chain.
- **Older Core without that format:** the CLI adds new migration files and rejects conflicting changes to an existing migration. A reviewed equivalent can be recorded in `.supacharger/migration-aliases.json`; matching filenames alone do not prove equivalence.

For declarative updates, migration generation uses the project's installed Supabase CLI and planner tools. Changed dependencies are installed first. Conflicting definitions, changed migration history or data changes that cannot be classified stop for review.

When the update adds or generates migration files, the CLI shows a dry run against the linked Supabase project and asks separately before applying SQL. Confirm which project is linked and review **every migration shown**, including your application's own pending migrations. File recovery copies do not back up the database.

Declining the database step leaves the changed application files in place and the Core version record unchanged. An unfinished declarative update is recorded in `.supacharger/database-update.json`. Keep that record for a matching retry; do not edit its checksums or delete it to bypass a failure. The CLI verifies the generated migrations against the linked database's applied-migration list before clearing it.

## If an update stops

Read the reported conflict and inspect the Git diff and `.supacharger/backups/`. Restore or reconcile the affected files before retrying. An update is not an automatic rollback: files may already have changed even though the Core version record has not advanced.

Restoring files does not undo SQL already applied to a database. Resolve database changes with reviewed forward migrations. After the update completes, use your project's build, type checks and application checks, then verify any affected hosted features separately.
