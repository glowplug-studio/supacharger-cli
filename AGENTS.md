# Supacharger CLI Agent Instructions

Apply the workspace-level Supacharger source-of-truth and synchronisation rules when changing this project.

Generated or upgraded PostgreSQL functions and PostgREST RPCs must not prefix exposed argument names with `p_`. CLI templates and upgrade logic must preserve forward-only migrations and keep generated callers, database types, OpenAPI descriptions, and Bruno requests aligned with descriptive unprefixed argument names.

Keep exact managed contract tests limited to reusable Supacharger behaviour. Preserve `test/project-billing-schema-contract.test.mjs` as a developer-owned consumer seam, and preserve consumer package scripts that add the project test alongside the shared managed test.

<!-- BEGIN:shared-bruno-rpc-guidance -->

## Bruno RPC maintenance

- Treat `docs/bruno/supacharger-rpc/` and `scripts/check-bruno-rpc-parity.mjs` as exact CLI-managed Core assets. Keep them byte-identical to the installed Core lock in every managed consumer.
- Add, update, rename, or remove the matching canonical Bruno request in the same change as every reusable client-callable `api` RPC contract change. Keep method, URL, schema headers, authentication, arguments, body, example, response expectations, status behaviour, and embedded documentation aligned.
- Run `npm run check:bruno-rpcs` before reporting an RPC or Core-alignment task complete. The Core check requires documentation for every current Core `api` RPC. In a consumer it requires every canonical Supacharger RPC while allowing additional product-owned RPCs.
- Keep consumer-specific RPC requests in the owning application's developer-managed Bruno collection and verification command. Do not add them to `docs/bruno/supacharger-rpc/` unless the RPC is first approved and implemented as a reusable Core contract.
- Never commit access tokens, service-role keys, secret keys, or customer data to a Bruno request or environment.
- The CLI must install the shared checker, collection, and missing required package script, run the declared parity check, and refuse to advance `.supacharger/core-lock.json` when parity fails.

<!-- END:shared-bruno-rpc-guidance -->

<!-- BEGIN:shared-svg-svgr-guidance -->

## UI SVGs and SVGR

- Store UI SVGs under an appropriate developer-owned `src/` path belonging to the feature or surface that owns them.
- Store demo-only SVGs under `src/components/sc_demo/` so removing the demo also removes its assets.
- Import UI SVGs as React components through SVGR. Use `public/` only when an asset genuinely needs a URL, such as metadata, a manifest, or an external integration contract.
- Keep every SVG responsive and preserve its aspect ratio. Every source SVG must have a valid `viewBox`.
- When CSS or Tailwind controls the rendered size, remove root-level intrinsic `width` and `height` attributes from the source SVG.
- Size SVG components at the call site with classes such as `size-*`, `w-*`, `h-*`, or `size-[1em]`. Usually add `shrink-0` when an SVG sits beside text.
- Do not force mismatched width and height values that distort the source aspect ratio. Do not fix clipping by adding arbitrary `width` or `height` props to the React component.
- Use `fill='currentColor'` or `stroke='currentColor'` only when the artwork is intended to inherit the surrounding text colour.
- Before changing an SVG component's sizing classes, inspect the rendered `<svg>` and confirm that SVGR/SVGO preserved its `viewBox`. For sizing such as `h-8 w-auto`, verify that the complete artwork stays inside the rendered bounds at every intended viewport size.
- Add a regression test asserting that responsive SVG assets retain their `viewBox` and omit root-level intrinsic dimensions. Visually verify SVG changes in the browser on every affected page.

A responsive source SVG root should look like:

```svg
<svg viewBox="0 0 323 46" ...>
```

Avoid root-level intrinsic dimensions when CSS controls sizing:

```svg
<svg width="323" height="46" viewBox="0 0 323 46" ...>
```

<!-- END:shared-svg-svgr-guidance -->

## Mandatory English catalogue and translation policy

- Every task that adds or changes user-facing copy, introduces or changes a `useTranslations` or `getTranslations` call, or adds or changes a translation key must add or update the complete English source value in `messages/en.json` in the same change. This is required even when the human did not ask for translation work.
- Before reporting the task complete, verify that every referenced namespace and every statically referenced key exist in `messages/en.json` with non-empty English values. The consuming code and English catalogue are one atomic change; a task with missing English messages is incomplete and must not be reported as complete.
- Do not invent, machine-translate, copy English wording into, or otherwise fill any secondary-language value unless the human explicitly asks for translation into that specific language.
- When catalogue structure or validation requires corresponding keys in secondary catalogues, add those keys with empty strings as untranslated placeholders. Otherwise leave secondary catalogues unchanged.
- Treat empty secondary-language values as pending translation. Do not describe the affected language, catalogue, or surface as translated, complete, or reviewed.
- Run the project's English-catalogue or i18n validation command when one exists. The absence of an automated check does not waive the manual English namespace and key verification.
- Keep this entire policy verbatim in the workspace `AGENTS.md` and every project or nested `AGENTS.md`; do not shorten, paraphrase, or relocate it solely to another guidance file.
