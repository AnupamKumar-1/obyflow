# Contributing to Obyflow

Thanks for taking the time to contribute! This guide covers everything you need to get a change merged.

## Project structure

Obyflow is a monorepo:

- **TypeScript** packages live under `packages/` and are managed with **pnpm workspaces** + **Turborepo**.
- The **Python SDK** lives under `python/obyflow-python/` and is a standalone `pip`-installable package.

## Getting set up

```bash
git clone https://github.com/<you>/obyflow.git
cd obyflow
pnpm install
pnpm build
pnpm test
```

For the Python SDK:

```bash
cd python/obyflow-python
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

## Making a change

1. **Create a branch** off `main`: `git checkout -b feat/short-description`.
2. **Write the change**, keeping it scoped to one concern.
3. **Add or update tests.** Every package uses [Vitest](https://vitest.dev) (TS) or [pytest](https://pytest.org) (Python) — new behavior needs new test coverage, and bug fixes should include a regression test.
4. **Run the full suite** before opening a PR:
   ```bash
   pnpm build && pnpm test
   ```
   or, to iterate on a single package:
   ```bash
   pnpm --filter @obyflow/core test
   ```
5. **Keep commits focused** and write clear commit messages (imperative mood, e.g. `Fix trace correlation for retried requests`).

## Git hooks

This repo uses [Husky](https://typicode.github.io/husky/) to run checks automatically once you've run `pnpm install` (which triggers the `prepare` script):

- **pre-commit** runs `pnpm test` — commits are blocked if any package's test suite fails.
- **pre-push** runs `pnpm exec eslint .` — pushes are blocked on lint errors.

These mirror what CI checks, so fixing them locally before committing/pushing saves a round trip through CI.

## Code style

- TypeScript: strict mode is enabled repo-wide (`tsconfig.base.json`) — please don't add `any` without good reason, and keep new modules typed.
- Match the existing formatting/conventions in the file you're editing rather than introducing a new style.
- Prefer small, composable functions, especially in `packages/core`, which is depended on by everything else.
- Python: code must be linted with [ruff](https://docs.astral.sh/ruff/) and [Pylint](https://pylint.readthedocs.io/) before it is submitted. ruff is not part of the `[dev]` extras or installed by CI, so run `pip install ruff` first; then run `ruff check .` and `pylint <changed files>` from `python/obyflow-python/` and fix any reported issues (or justify a suppression in the PR description).

## Adding a new package

- TypeScript packages go under `packages/` (or a relevant subfolder like `packages/llm/`) and must be picked up by `pnpm-workspace.yaml`.
- Depend on other workspace packages with `"workspace:*"`.
- Add a `build`/`test` script and a `tsconfig.json` that extends `../../tsconfig.base.json` so it participates in `pnpm build` / `pnpm test`.

## Adding a new CLI command

- Commands live in `packages/cli/src/commands/` (one file per command, e.g. `export.ts`, `prune.ts`) and are registered in `packages/cli/src/cli.ts` via a `register<Name>Command(program)` function.
- Reuse the shared `--db`, `--service`, and `--since`/`--until` option conventions used by existing commands (see `traces.ts`, `export.ts`) so behavior stays consistent across the CLI.
- Add a matching `<command>.test.ts` file alongside the command (see `config.test.ts`, `incident.test.ts`, `usage.test.ts` for examples) and document the new command in the README's CLI usage section.

## Adding a new LLM or vector DB adapter

- LLM adapters implement the interface in `packages/llm/llm-core` and live in their own `packages/llm/llm-<provider>` package.
- Vector DB adapters live in `packages/adapters/adapter-vectordb/src/`.
- Wire new LLM providers into `packages/cli/src/llm/create-adapter.ts` and the `LLMProvider` type in `packages/core`.

## Changing CI / GitHub Actions workflows

Workflow files under `.github/workflows/` are checked by a dedicated `GitHub Actions Scan` workflow on every PR, using [actionlint](https://github.com/rhysd/actionlint) (via `reviewdog/action-actionlint`) and [zizmor](https://github.com/woodruffw/zizmor) (a GitHub Actions security linter). If you add or edit a workflow, run these locally where possible and keep third-party actions pinned to a full commit SHA (as the existing workflows do) rather than a mutable tag.

[Dependabot](https://docs.github.com/en/code-security/dependabot) opens weekly update PRs for npm dependencies (root workspace) and pip dependencies (`python/obyflow-python`), capped at 5 open PRs per ecosystem — routine version bumps don't need a manual PR.

## Cross-SDK parity

The Node SDK (`packages/node-sdk`, backed by `packages/core` and `packages/adapters/*`) and the Python SDK (`python/obyflow-python`) implement the same event schema, redaction rules, resource-attribute detection, and instrumentation independently in two languages. There is no shared runtime between them, so nothing keeps them in sync automatically except this process.

If your change touches any of the following in one SDK:

- Event schema (`packages/core/src/event-model/event.schema.ts` / `python/obyflow-python/obyflow/events.py`)
- Redaction rules (`packages/core/src/evidence/redact.ts` / `python/obyflow-python/obyflow/redaction.py`)
- Resource-attribute detection (`resource-attributes.ts` / `resource_attributes.py`)
- Instrumentation behavior (HTTP, LangChain, vector-DB adapters, trace-context propagation)

then you must do one of the following in the same PR:

- Mirror the change in the other SDK, or
- Open a tracked follow-up issue for the other SDK and link it in the PR description.

A `parity` CI job runs baseline checks against both SDKs on every PR; see `scripts/check-parity.sh`.

## Reporting bugs / requesting features

Please open a GitHub issue with:

- What you expected to happen vs. what actually happened
- Steps to reproduce (CLI command, SDK snippet, or a minimal repro)
- Obyflow version, Node/Python version (CI runs Node 24), and OS

## Pull request checklist

- [ ] `pnpm build` and `pnpm test` (or `pytest` for Python changes) pass locally
- [ ] `ruff check .` and `pylint` pass with no errors for any changed Python files
- [ ] New/changed behavior has test coverage
- [ ] Public APIs (CLI flags, SDK exports) are documented in code comments or the README where relevant
- [ ] No unrelated formatting churn
- [ ] Cross-SDK parity: mirrored in the other SDK, or a follow-up issue is linked (see "Cross-SDK parity" above)

By contributing, you agree your contributions will be licensed under the project's [MIT License](./LICENSE).
