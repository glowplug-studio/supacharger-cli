# Deferred extension distribution

Extension installation is deliberately excluded from the npm CLI release. The published package should expose only implemented and supported Core, doctor, initialisation and public-skill commands.

## Product direction

Build extension delivery as a private source-distribution service using Supacharger itself:

1. Keep extension source in a private repository.
2. Build an immutable, deterministic archive from an approved version tag.
3. Upload the archive to private Supabase Storage and record its SHA-256 digest, compatibility requirements and release metadata.
4. Validate the customer's purchase, subscription, organisation and seat entitlement through the service API.
5. Return a short-lived signed download URL; never put the licence token in that URL or logs.
6. Download and verify the archive before showing an installation plan.
7. Install through a transactional, ownership-aware process that protects Core paths, local edits and forward-only migrations.
8. Record installed extension versions and file hashes separately from the Supacharger Core lock.
9. Support integrity checks, explicit updates and recovery before considering removal or automatic deployment.

The first proving package should be the Brevo extension. The experimental installer remains available in the Supacharger Core repository and Git history for reference, but it is not part of the npm CLI contract.

## Possible future commands

```text
supacharger login
supacharger extension install <id> --plan
supacharger extension install <id>
supacharger extension update <id> --plan
supacharger extension doctor <id>
```

Do not expose these commands until authentication, entitlement validation, immutable release retrieval, checksum verification and end-to-end tests are implemented.
