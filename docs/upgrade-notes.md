# Configuration and upgrade notes

[Back to the README](../README.md) · [Update workflow](updating-core.md)

This page is for developers upgrading an existing application. File paths and setting names are kept exact so you can find them. Changes depend on your installed and incoming Core versions; review `supacharger coreupdate --plan` rather than applying every item by hand.

## Keep product customisations in product files

Shared routes live under `src/app/(supacharger)/`. Product routes belong under `src/app/(project)/`, with application integrations in `src/supacharger.adapters/`. Adapters are the files where your application supplies its own behaviour around Core features.

The updater adds missing auth, account, billing and organisation adapter starters but preserves existing ones. This includes the request guard and organisation page, navigation, chrome and profile-extension adapters. Customise these files rather than editing the shared implementations they call.

`tailwind.config.ts` is an exact Core-managed file. Put your own Tailwind additions in `tailwind.project.config.ts`, which is added only when absent. If an older root Tailwind file contains custom changes, move them into the project preset before updating. Use `src/styles/project.css` for the application's shared colours and styling choices.

`postcss.config.mjs` is Core-managed. An unchanged legacy `postcss.config.js` is backed up and removed during migration. A customised legacy file stops the update so its changes can be reviewed.

## Root layout and branding

Initial setup supplies `src/app/layout.tsx`. Later updates preserve your fonts, providers, body classes and extra head content there. Shared document behaviour is supplied through `src/supacharger/root-document.tsx`.

The updater can add missing `METADATA`, `ROOT_PROVIDERS` and `ANALYTICS` settings while retaining existing application values. It derives the title template from the current title, enables favicon declarations only when the standard files exist, and leaves Google Analytics disabled until `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is configured.

Your inline loaders and image placeholder remain yours:

- `src/assets/svgr/ui/inline-loader.svg`
- `src/assets/svgr/ui/inline-loader-dark.svg`
- `src/assets/svgr/ui/image-loader.svg`

Missing starter assets can be added; existing artwork is preserved. Initial setup also copies `public/images/email-template/email-logo.png`. Replace and commit that email logo for your application. Core updates preserve the directory but do not install missing email branding files.

## Application configuration

Your values stay in `src/supacharger.config.ts`. Core supplies the shared setting names and types through `src/supacharger/supacharger-config-contract.ts`.

Supported configuration migrations add missing settings while preserving existing values. These include profile media, account settings, organisations, billing account subjects, session transfer and sign-out policy. The plan identifies the changes required for your version.

For older applications, check these specific transitions:

| Area | What to check |
| --- | --- |
| Route guard spelling | Rename the historical `PATH_AUTH_GARD` key to `PATH_AUTH_GUARD` before adopting the corrected contract. |
| Social providers | The legacy `AUTH_PROVDERS_ENABLED` map can gain missing provider keys, set to `false`. Enable a provider only after its Supabase and callback configuration is ready. |
| Session verification | Obsolete `AUTH_SESSION.VERIFICATION_MODE` is removed. The shared Proxy uses `getClaims()` as its fixed verification approach. |
| Authenticator apps | Obsolete `AUTHENTICATION.MFA_TOTP.ENABLED` is removed; account security always supports factor management. `REQUIRED_FOR_SIGN_IN` is preserved. |
| Local authenticator support | The local Supabase enrolment and verification settings are enabled. Restart the local stack afterwards; hosted capability is a separate setting. |
| Organisation URLs | Canonical chooser and route-mode values move to `/organisation/choose` and `organisation-handle`. Review your own navigation and return URLs too. |

## Access checks and recovery pages

Core supplies `requireVerifiedUser()`, `requireOnboardedUser()` and `requireAppAccess()` for progressively stronger access checks. Existing product recovery pages are not moved automatically.

When adopting that structure, place profile setup under a verified-user layout and billing acquisition under an onboarded-user layout. Keep full product routes under `requireAppAccess()`. Preserve public URLs and verify the route destinations and access checks manually; `doctor` does not check layout ancestry or recovery journeys.

Shared Proxy logic belongs in `src/lib/supabase/supacharger/proxy.ts`; shared access checks in `src/supacharger/auth/server-access.ts`. Auth-provider SVGs live in `src/supacharger/assets/svgr/auth-providers/`. Updates can remove superseded Core-owned paths while preserving product-owned assets.

## Signup terms

`AUTHENTICATION.SIGN_UP_TERMS_URL` accepts an absolute HTTP(S) URL. The default `null` hides the notice. Invalid, relative or credential-bearing URLs are not shown. Configure your own terms URL before expecting the notice to appear.

The notice appears beneath signup actions and on the social-provider chooser, where signing in can also create an account. It is a displayed link, not a required checkbox or a saved consent record. `ACCOUNT_REQUIRED_TERMS_AGREEMENT_PATH` remains a separate setting.

The English messages are `AuthJourney.signUpTerms`, `signUpTermsSocial`, `signUpTermsSocialOnly`, `signUpTermsPasswordless` and `signUpTermsPasswordlessSocial`. Keep their `<terms>...</terms>` link tags when translating. Upgrades add a missing setting as `null` and preserve an existing URL.

## Image processing and media delivery

Image upload target settings belong in `src/supacharger.adapters/media/image-targets.ts`. If the old `supabase/functions/_shared/image-targets.ts` exists and the new adapter does not, the updater migrates that policy. Existing new adapters are preserved.

Core updates also configure the `profile-media` Edge Function to accept public requests. The handler still checks each image using the caller's Storage access rules. Set the environment's database media origin and coordinate profile API changes with the application release. Follow the installed Core's profile and image-transformation guidance before deploying these changes.

## Agent guidance and translations

Read the installed `AGENTS.md` first. Core updates preserve existing project instructions and add missing reference files under `docs/agents/`; review preserved references when upstream guidance changes.

Initial setup removes Core-only test suites, fixtures and test scripts. Updates also remove recognised test package scripts; review the plan for the affected entries. They do not install or run an application test suite. Existing project files outside obsolete managed paths are not swept away. Use the application's own agreed verification workflow.

Locale configuration and secondary catalogues are preserved. English updates add missing keys and fill empty values without overwriting product wording. Installed skills and their source records remain separate from the Core version.
