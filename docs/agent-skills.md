# Agent skills

[Back to the README](../README.md)

A skill is a reusable set of instructions for your coding agent. It helps the agent follow a particular workflow. Skills are separate from Core updates and from extensions that add application features.

## Install from the public catalogue

Run this inside an installed Supacharger application:

```bash
supacharger skills install
```

The interactive picker shows the free [Glowplug skills catalogue](https://github.com/glowplug-studio/glowplug-skills). Select skills with Space and confirm with Enter. An empty selection skips installation.

For an agent or unattended command, supply the skill's identifier:

```bash
supacharger skills install general/changelog
```

Without identifiers, a non-interactive command stops and asks you to provide them. Interactive project setup also offers skills unless you use `supacharger init my-project --skip-skills`.

## Update a skill deliberately

```bash
supacharger skills update general/changelog
```

Use `supacharger skills update` for the interactive picker. Core updates do not update skills automatically.

Skills are installed in `.agents/skills/<name>/`. The record in `.supacharger/skills-lock.json` identifies the source repository, exact commit and a checksum of each complete skill folder. Commit the installed skills and this record together.

The installer refuses to overwrite local edits, an untracked destination or a skill tracked from a different source. It does not execute the scripts it downloads. If installation was interrupted, inspect `.supacharger/skills-install.lock` and any `skills-transaction-*` recovery data before retrying.

## Use a reviewed source

To select an exact public revision:

```bash
supacharger skills install general/changelog --ref <commit-or-tag>
```

Licensed skills are not listed in the free picker. If you have access to a licensed or other reviewed local repository, use its committed checkout:

```bash
supacharger skills install supacharger/core-upgrade-review --source /path/to/supacharger-license-skills
supacharger skills update supacharger/core-upgrade-review --source /path/to/supacharger-license-skills
```

Uncommitted source changes are not exported. The installation record keeps the actual GitHub source when recognised; a local source without one is recorded as `local/skills-source`. Later updates must use the same source repository.

See [Agent guidance](https://supacharger.dev/docs/agents) and [Skills](https://supacharger.dev/docs/skills) for how an agent uses installed instructions. Check your installed CLI's `--help` for command availability.
