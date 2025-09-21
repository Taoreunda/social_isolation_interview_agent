# Repository Guidelines

## Project Structure & Module Organization
`main.py` bootstraps the Streamlit app, while user-facing flows live in `pages/chat.py` (interview run) and `pages/result.py` (reporting). Core orchestration sits in `interview/`: `flow_engine.py` wires LangGraph nodes, `controller.py` loads `interview_flow.json`, `state_manager.py` tracks conversation state, and `prompts.py` centralizes LLM templates. Persisted artefacts are written via `storage/json_storage.py` into `data/interviews/` and `data/results/`. Runtime logs remain local under `logs/` and should stay out of version control.

## Build, Test, and Development Commands
Install or refresh dependencies with `uv sync`. Launch the local app using `uv run streamlit run main.py`. Targeted checks: `uv run python tests/test_flow_scenarios.py` exercises the LangGraph pathing; `uv run python tests/test_refactored_components.py` validates helper utilities; the scenario fixtures under `tests/test_scenarios/` can be invoked with `uv run python -m tests.test_scenarios.cli`. Keep a `.venv` active or rely on `uv run` to resolve the environment for each command.

## Coding Style & Naming Conventions
Follow PEP 8 with four-space indentation and type hints on public interfaces. Modules use `snake_case.py`, classes use `CamelCase`, and constants stay upper snake (`MAX_TURNS`). Keep docstrings bilingual only when the existing module already mixes Korean summaries; otherwise default to concise English. Prefer dependency injection (pass storage or LLM clients) over importing singletons so test doubles remain easy.

## Testing Guidelines
Place new tests in the repository-level `tests/` directory and name modules `test_*.py`. Mock external services (Gemini, storage) to keep runs deterministic. Integration tests that require `GOOGLE_API_KEY` or LangSmith tracing should detect missing secrets and skip gracefully. Before pushing, run at least one high-level flow (`uv run python tests/test_flow_scenarios.py`) plus any new unit suites you introduce.

## Commit & Pull Request Guidelines
Write commit subjects in present tense with an area prefix, e.g. `feat(flow): handle early stop`. Group related changes; avoid mixing refactors with bug fixes. PRs should summarize user-visible effects, list the test commands executed, link tracking issues, and include screenshots or CLI snippets for UI tweaks. Call out new environment variables, data files, or migrations so reviewers can reproduce locally.

## Security & Configuration Tips
Manage secrets through `.env` for local work or `.streamlit/secrets.toml` in deployment; never commit raw keys or interview transcripts. Logs under `logs/` are for temporary debugging—scrub or delete them before sharing archives. If LangSmith tracing (`LANGSMITH_TRACING`, `LANGSMITH_API_KEY`) is enabled, verify that runs are cleared from the dashboard after debugging sessions to avoid lingering personal data.
