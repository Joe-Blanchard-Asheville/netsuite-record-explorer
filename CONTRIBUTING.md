# Contributing

Describe the failing workflow and expected behavior in an issue before a broad change. A useful pull request explains the problem, the change and its observable effect, then links the tests or account evidence.

Use Node.js 22+, run `npm ci`, and keep the lockfile in sync. Run `npm run format`, `npm test`, `npm run check`, `npm run build`, and `npm run test:browser`. Add focused regressions for changed permission, partial-data or stale-state behavior.

Shared domain/adapter modules are vendored in each sibling tool. Check whether a fix applies to the other repositories; record that follow-up instead of silently allowing drift. Do not import private account configuration or unrelated repository history.

A demo pass, a native API mock pass and a sandbox pass are different results. Keep the native integration status pending until the acceptance matrix is filled with actual observations. Store sanitized test evidence only. Preserve applicable dependency licenses and notices.
