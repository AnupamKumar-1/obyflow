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

## Code style

- TypeScript: strict mode is enabled repo-wide (`tsconfig.base.json`) — please don't add `any` without good reason, and keep new modules typed.
- Match the existing formatting/conventions in the file you're editing rather than introducing a new style.
- Prefer small, composable functions, especially in `packages/core`, which is depended on by everything else.
- Python: code must be linted with [ruff](https://docs.astral.sh/ruff/) and [Pylint](https://pylint.readthedocs.io/) before it is submitted. Run `ruff check .` and `pylint <changed files>` from `python/obyflow-python/` and fix any reported issues (or justify a suppression in the PR description).

## Adding a new package

- TypeScript packages go under `packages/` (or a relevant subfolder like `packages/llm/`) and must be picked up by `pnpm-workspace.yaml`.
- Depend on other workspace packages with `"workspace:*"`.
- Add a `build`/`test` script and a `tsconfig.json` that extends `../../tsconfig.base.json` so it participates in `pnpm build` / `pnpm test`.

## Adding a new LLM or vector DB adapter

- LLM adapters implement the interface in `packages/llm/llm-core` and live in their own `packages/llm/llm-<provider>` package.
- Vector DB adapters live in `packages/adapters/adapter-vectordb/src/`.
- Wire new LLM providers into `packages/cli/src/llm/create-adapter.ts` and the `LLMProvider` type in `packages/core`.

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

By contributing, you agree your contributions will be licensed under the project's [MIT License](./LICENSE).
