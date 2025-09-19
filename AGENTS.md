# Repository Guidelines

## Project Structure & Module Organization
The Streamlit entry point lives in `main.py`, while interactive pages sit under `pages/` (`chat.py` for the interview flow, `result.py` for reporting). Core interview logic is grouped in `interview/` (controllers, flow engines, rule engine, and state manager). Persistent storage helpers live in `storage/json_storage.py`, which writes to `data/interviews/` and `data/results/`. Keep large transcripts or logs out of git; use `logs/` for local debugging artifacts.

## Build, Test, and Development Commands
Run `uv sync` to install or refresh dependencies declared in `pyproject.toml`. Launch the Streamlit app with `uv run streamlit run main.py`. Smoke-test imports quickly with `uv run python test_simple.py`. Exercise the async flow simulator with `uv run python test_v2_architecture.py`, and run the broader integration harness via `uv run python test_interview.py` (requires `GOOGLE_API_KEY`).

## Coding Style & Naming Conventions
Follow PEP 8 with four-space indentation and type hints for public methods. Modules and files use `snake_case.py`; classes follow `CamelCase`. Keep docstrings in English first, optionally mirroring the existing Korean summaries. Prefer dependency injection over globals, and route new orchestration code through the existing controllers or engines instead of ad-hoc scripts.

## Testing Guidelines
Add deterministic unit coverage around `interview/` components when introducing new branching logic. Name new test modules `test_*.py` in the repository root and invoke them with `uv run python path/to/test_file.py`. Integration tests that hit Gemini require a populated `.env`; guard them so they skip politely when keys are absent. Update or generate fixtures under `data/` only when sanitized of participant information.

## Commit & Pull Request Guidelines
Use present-tense, area-focused commit subjects (e.g., `feat(flow): add rebuttal path`) and include context in the body if behavior changes. For PRs, link the tracking issue, summarize user-facing impacts, list test commands run, and attach screenshots or terminal snippets for UI adjustments. Highlight any new environment variables or storage schemas so reviewers can reproduce locally.

## Environment & Secrets
Copy `.env.example` if available or create `.env` with `GOOGLE_API_KEY`, `LANGSMITH_API_KEY`, and tracing flags before running tests. Never commit credential files or raw interview exports. When collaborating, share secret material through the team vault rather than inline comments or issue threads.
