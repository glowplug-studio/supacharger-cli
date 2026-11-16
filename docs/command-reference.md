# Command reference

[Back to the README](../README.md)

These commands describe this repository's source. Your installed npm release may be older. Use the built-in help to check its options:

```bash
supacharger --version
supacharger --help
supacharger init --help
```

In examples, `<name>` means a value you replace; do not type the angle brackets. Run application commands from your installed Supacharger project. Most look upwards for the nearest `.supacharger/core-lock.json`, the record of its Core version.

## Main commands

| Command | Purpose | Options |
| --- | --- | --- |
| `supacharger init [target]` | Install Core into a folder; defaults to the current folder. | `--namespace <code>`, `--skip-skills`, `--registry <location>` |
| `supacharger which --core` | Show the installed Core version. | `-c` is the short form. |
| `supacharger which --extension <name>` | Show an extension's published registry version. | `-e <name>`, `--registry <location>` |
| `supacharger doctor` | Inspect shared files and application configuration without changing them. | `--ref <tag-or-commit>`, `--source <path>` |
| `supacharger coreupdate` | Update Core after review and confirmation. | `--plan`, `--ref <tag-or-commit>`, `--source <path>` |
| `supacharger --version` | Show the CLI package version. | `-V` is the short form. |

`--ref` for Core accepts a registered release version, tag or full commit. `--source` for Core is intended for maintainers reviewing a local checkout; its commit must still be registered. A plan does not change the application or deploy database changes.

## Skills and extensions

| Command | Purpose | Options |
| --- | --- | --- |
| `supacharger skills install [ids...]` | Install selected agent skills. | `--ref <tag-or-commit>`, `--source <path>` |
| `supacharger skills update [ids...]` | Update selected tracked skills. | `--ref <tag-or-commit>`, `--source <path>` |
| `supacharger extension available` | List registered extensions and offer interactive selection. | `--registry <location>`, `--root <path>` |
| `supacharger extension install <name>` | Install a release or reviewed local bundle. | `--plan`, `--source <path>`, `--registry <location>`, `--root <path>` |
| `supacharger extension update <name>` | Compare and apply an extension update. | `--plan`, `--source <path>`, `--registry <location>`, `--root <path>` |
| `supacharger doctor --extension <name>` | Compare installed extension files with a release. | `--source <path>`, `--registry <location>`, `--root <path>` |

`extension list` aliases `extension available`. `extension doctor <name>` is the older form of `doctor --extension <name>` and accepts the same extension options. Extension diagnosis does not accept `--ref`.

`--registry` selects a registry manifest URL or local file. `--root` selects the target application for extension commands. Skills use a separate catalogue and default to its `main` branch; the installed record saves the resolved commit.

## Core contributor commands

```bash
supacharger coredev install
supacharger coredev update
```

These manage optional private contributor instructions. They are not needed to build an application. See [Contributing](contributing.md).

## Version compatibility

This source supports Core `>=0.0.1-alpha <0.0.2`, including `0.0.1` prereleases. Application commands reject a missing, invalid or unsupported Core version. `init` checks the release it will install; Core updates and diagnosis also check the incoming release.

The CLI package version and the application's Core version are different. Use `supacharger --version` for the former and `supacharger which --core` for the latter. `which --extension` reads the registry rather than an installed extension record.

To install the latest published CLI:

```bash
npm install -g @glowplug/supacharger-cli@latest
```

Help and `--version` work without an application. General MCP setup and application deployment are handled through the [agent and provider workflow](getting-started.md#work-with-your-agent-and-mcp), not standalone CLI subcommands.
