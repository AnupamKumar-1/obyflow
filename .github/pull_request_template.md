## Summary

## Checklist

- [ ] `pnpm build` and `pnpm test` (or `pytest` for Python changes) pass locally
- [ ] `ruff check .` and `pylint` pass with no errors for any changed Python files
- [ ] New/changed behavior has test coverage
- [ ] Public APIs (CLI flags, SDK exports) are documented in code comments or the README where relevant
- [ ] No unrelated formatting churn

## Cross-SDK parity

- [ ] This PR touches event schema, redaction, resource attributes, or instrumentation behavior in only one SDK, and I mirrored the change in the other SDK in this PR
- [ ] This PR touches event schema, redaction, resource attributes, or instrumentation behavior in only one SDK, and I opened a follow-up issue for the other SDK: <link>
- [ ] This PR does not touch shared event schema, redaction, resource attributes, or instrumentation behavior
