# Extensions

[Back to the README](../README.md)

Extensions add optional features to an application, such as transactional email. The registry is the catalogue that tells the CLI where to find each extension and which release to use.

This guide describes the current repository source. Some extension commands may not yet be in your npm release; check `supacharger extension --help` first.

## Find an extension

From your Supacharger application, run:

```bash
supacharger extension available
```

The CLI lists registered extensions and marks those whose expected files are present. In an interactive terminal, it offers a selection. `supacharger extension list` is an alias for the same command.

During interactive `init`, the current picker offers transactional email. Selecting it runs the installer. Missing release information or dependencies are reported; the CLI does not pretend installation succeeded.

## Preview and install

Use the extension's registered name or short ID:

```bash
supacharger extension install <name> --plan
supacharger extension install <name>
```

The plan validates the bundle and lists file changes without changing the application. Without `--source`, the CLI downloads the registered GitHub release archive and verifies its checksum, which confirms the download matches the registered file.

The release must have a version, an exact source commit and valid download information. The bundle must also match the application's resource namespace. Missing or disabled required extensions and missing Core services stop installation.

For a reviewed local bundle:

```bash
supacharger extension install <name> --source /path/to/release --plan
supacharger extension install <name> --source /path/to/release
```

If a published release exists, the local Git checkout must be clean and match that release's exact commit. A registered extension without published release information can be reviewed locally, but the CLI reports it as unverified.

## Update and inspect

```bash
supacharger extension update <name> --plan
supacharger extension update <name>
supacharger doctor --extension <name>
```

All three accept `--source /path/to/release` for a local bundle. The older `supacharger extension doctor <name>` spelling is also supported.

Updates compare installed files directly with the incoming bundle. Equal files are skipped; changed extension-owned files are replaced. Your extension configuration is preserved, existing migration files must match exactly, and files outside the bundle are left alone.

The comparison cannot tell whether a difference is your local edit or a change from the extension author. Review the plan and Git diff before updating. The CLI does not store a separate extension installation receipt.

Extension `doctor` only compares files. Differences return exit status `1`; matching files return `0`. A successful comparison does not prove the extension is configured, enabled or deployed. Likewise, `which --extension <name>` reports the **published registry version**, not a tracked installed version.

## Finish setup

Read the extension's installed `INSTALL.md` and agent guide. Copying its files does not apply database migrations, deploy Edge Functions or workers, set secrets, load translations or enable the feature. Complete those steps with your agent or the relevant provider tools, then verify the feature in your application.

For bundle authors, see the [contributor guide](contributing.md#extension-bundles). For all supported options, see the [command reference](command-reference.md).
