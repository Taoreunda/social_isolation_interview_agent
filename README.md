# Social Isolation Interview Agent

This project provides a Streamlit-based interview experience that guides a participant through a diagnostic flow for social isolation / hikikomori. Each turn is evaluated by a Gemini-based LLM, while the question order and branching are managed by a LangGraph state machine.

## Key Features

- **Streamlit UI** – conversational interview interface.
- **LangGraph Engine** – deterministic question sequencing with rule-based branching.
- **LLM Evaluation** – Gemini 2.5 Flash judges each answer and proposes clarifications.
- **JSON Storage** – sanitized interview summaries saved under `data/` for later review.

## Setup

1. **Install dependencies**
   ```bash
   uv sync  # Installs Python dependencies from pyproject
   ```

2. **Configure environment**
   Copy `.env.example` (if available) or create `.env` and set the required keys:
   ```bash
   GOOGLE_API_KEY="your_gemini_api_key"
   LANGSMITH_API_KEY="your_langsmith_key"
   LANGSMITH_TRACING=true
   LANGSMITH_PROJECT="social-isolation-interview"
   ```

3. **Launch the app**
   ```bash
   uv run streamlit run main.py
   # Then open http://localhost:8501
   ```

## Running the Interview

1. Start the Streamlit app (`uv run streamlit run main.py`).
2. On the landing page, click **“🚀 인터뷰 시작하기”**.
3. Answer each question. The LLM analyzes responses and may ask clarifications using a warm, empathic tone.
4. When criteria are satisfied, the flow ends and a summary is stored under `data/results/`.

## Architecture

```
streamlit UI ─► interview.flow_engine.InterviewFlowEngineV2 ─► LangGraph state machine
                          │
                          └── interview.controller.InterviewController (loads interview_flow.json)
```

- `interview_flow.json`: Defines question order, branching, and rule nodes.
- `interview/prompts.py`: Holds prompt templates with shared empathic guidance.
- `interview/flow_engine.py`: Orchestrates LangGraph nodes and LLM evaluations.
- `storage/json_storage.py`: Persists sanitized interview summaries.

## Tests & Troubleshooting

- Quick sanity check:
  ```bash
  uv run python tests/test_flow_scenarios.py
  ```
- If the LLM fails to respond (e.g., invalid API key or timeouts), an error is raised immediately so you can correct the environment.

## Notes

- Logs and results are ignored via `.gitignore`; keep sensitive data out of version control.
- The app expects Python 3.11+ (checked by `pyproject.toml`).
- Adjust the interview flow by editing `interview_flow.json`; prompts automatically pick up new question text.
