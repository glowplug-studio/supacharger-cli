# Getting started

[Back to the README](../README.md)

Supacharger Core is the shared starting point for your application. The CLI installs it and helps you keep it up to date. You can run the commands yourself or ask a coding agent to run them in your project.

These guides describe the source in this repository. Check `supacharger --version` and `supacharger init --help` before following an example: the npm release may not yet include every option described here.

## Before you start

Install Node.js, npm and Git. You also need Docker if you want to run Supabase on your own computer. The CLI does not install these system tools.

This CLI source requires Node.js 22.13 or later in the 22.x series, or Node.js 24 or later. The application you install may require a newer version. Follow the [Supacharger prerequisites](https://supacharger.dev/docs/guides/prerequisites) for the complete setup.

Install the CLI from [npm](https://www.npmjs.com/package/@glowplug/supacharger-cli):

```bash
npm install -g @glowplug/supacharger-cli@latest
supacharger --version
```

## Create a project

Choose a new or empty folder:

```bash
supacharger init my-project
cd my-project
```

The CLI looks up the current Core release in the Supacharger registry, the catalogue of available releases. It downloads that exact version and records it in `.supacharger/core-lock.json`. This record lets future updates identify what you installed.

Installation prepares the source before replacing the target's contents. It preserves an existing `.git` folder and restores the original contents if the installation stage fails. Using an empty folder avoids putting existing work at risk. Cancelling a later optional setup step can leave Core installed.

### Follow the setup questions

In an interactive terminal, the CLI offers these steps:

1. **Choose a resource prefix.** This optional short name keeps your application's Supabase resources distinct. Use 1–6 lowercase letters, digits or underscores, starting with a letter. Press Enter for the default `sc_` prefix. The choice is stored in `PROJECT_NAMESPACE` in `src/supacharger.config.ts`.
2. **Choose local Supabase, Supabase Cloud, or both.** Local means it runs on your computer; Cloud means a hosted Supabase project. Cloud setup asks for an existing project's connection details; it does not create the project for you.
3. **Enter application and optional Stripe settings.** The CLI creates `.env.local` from the supplied example and generates application signing secrets. Secret input is hidden. Pressing Enter on an empty prompt leaves the example value for you to complete later. An existing `.env.local` is preserved.
4. **Install application packages.** Accepting runs `npm ci` when a lockfile exists, otherwise `npm install`. It also runs the application's `setup:ui` script when available.
5. **Start local Supabase, if selected.** After packages are installed, the CLI starts the local stack, applies local migrations and writes its connection settings to `.env.development.local`. Cloud settings remain in `.env.local` when both are selected.
6. **Choose optional additions.** These include AI SDK packages, Stripe agent tooling, [agent skills](agent-skills.md) and the transactional-email [extension](extensions.md). The extension step installs files; it is not just a preview.

The optional AI SDK step installs `ai` and `@ai-sdk/react`. You still choose a model provider, configure its credentials and build the feature that uses it. Stripe agent tooling requires Stripe CLI to be installed already and delegates to Stripe's `stripe agent setup` command.

When Stripe billing is selected, setup asks for separate Supabase backend secret keys named `billing`, `stripe-events` and `stripe-reconciliation`. This allows each key to be replaced independently; the names do not restrict its database privileges. A session-transfer key is optional and separate. Use the installed project's `docs/agents/installation.md` to complete deferred credentials. Keep secret values out of Git and documentation.

### When an agent runs without prompts

The interactive steps require both terminal input and output. In an unattended run, `init` installs Core and records its version, but does not run the optional environment, package, service, skill or extension setup steps. Pass `--namespace <code>` if you need a custom prefix; otherwise the default is used.

Your agent should read the installed `AGENTS.md` and installation guidance, complete the remaining setup, then verify the application. If packages were skipped, install them and run `npm run setup:ui` when that script is present. Start the application with `npm run dev` after its required settings and services are ready.

## Work with your agent and MCP

A coding agent can read your project, explain decisions and run the CLI commands. MCP means **Model Context Protocol**: it gives the agent a standard way to use connected tools.

The Supacharger MCP provides read-only project guidance. Service MCP connections, such as Supabase, can let your agent inspect or manage the services you authorise. They are separate connections with their own permissions; installing this CLI does not automatically connect them.

Follow the [agent and MCP setup guide](https://supacharger.dev/docs/guides/mcp-setup). The guided workflow keeps progress in the application's `docs/reports/sc-install/first-install-handhold-me.md`, so you can return to the same project and ask your agent to resume setup.

## Deploy your application

Once local setup works, follow the [hosted setup guide](https://supacharger.dev/docs/guides/setup-wizard#6-select-the-hosted-environment) with your agent or manually. It covers the hosted database, application settings, provider configuration and deployment checks.

The agent uses the relevant service tools or MCP connections for deployment. The CLI has no standalone deployment command. Installing Core or an extension does not, by itself, make the application ready for production.

For routine maintenance, continue with [Updating Core](updating-core.md).
