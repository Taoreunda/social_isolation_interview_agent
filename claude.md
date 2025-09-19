# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Social Isolation Interview Agent (사회적 고립 인터뷰 에이전트)

## project overview
사회적 고립과 히키코모리 상태를 Gemini-2.5-flash 모델로 자동 분류하는 구조화된 인터뷰 웹앱.

## Essential Commands

```bash
# Run the Streamlit web application
uv run streamlit run main.py

# Run in background mode
uv run streamlit run main.py --server.port 8501 --server.headless true

# Run tests
uv run python tests/test_flow_scenarios.py

# Install dependencies
uv sync

# Test module imports
uv run python -c "from interview.flow_engine import InterviewFlowEngineV2; from storage.json_storage import JSONStorage; print('✅ All modules OK')"
```

## Environment Setup

```bash
# Install dependencies (using uv)
uv sync
```

Create a `.env` file with required API keys:
```bash
GOOGLE_API_KEY=your_gemini_api_key_here
LANGSMITH_API_KEY=your_langsmith_key_here
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=social-isolation-interview
```

## Architecture Overview

This application uses **LangGraph StateGraph** to implement a structured interview flow for social isolation assessment. The architecture has been simplified from 24 nodes to 5 core nodes:

### Core Components

1. **InterviewFlowEngineV2** (`interview/flow_engine.py`): Main engine using LangGraph StateGraph
2. **InterviewController** (`interview/controller.py`): Centralized question management
3. **StateManager** (`interview/state_manager.py`): Interview state persistence
4. **JSONStorage** (`storage/json_storage.py`): Results storage system

### LangGraph Flow (5 Node Architecture)

1. **`question_handler`**: Unified question processing with LLM evaluation and clarification logic
2. **`rule_evaluator`**: Evaluates A/B/C/D criteria based on collected responses
3. **`stop_rule_checker`**: Early termination when A/B/C are all negative
4. **`final_diagnosis`**: Classification into hikikomori/social isolation/normal
5. **`interview_complete`**: Result saving and completion

### Interview Configuration

Questions and evaluation logic are defined in `interview_flow.json`, structured for LangChain/LangGraph compatibility with:
- Question prompts for Gemini-2.5-flash
- Evaluation criteria (A1, A2, A3, B1, B2, C1, C2, D1, D2 criteria)
- Clarification strategies for ambiguous responses
- Rule-based routing logic

## Classification Criteria

### Diagnostic Rules
- **Hikikomori (히키코모리)**: Meets all A + B + C + D criteria
- **Social Isolation (사회적 고립)**: Meets B + C + D criteria (A can be negative)
- **Normal (일반)**: Early termination if A, B, and C are all negative

### Assessment Criteria
- **A - Home-bound behavior**: (A1 OR A2) AND A3
  - A1: Spends most of day at home/room
  - A2: Goes out <4 times per week
  - A3: Duration ≥6 months
- **B - Social interaction absence**: B1 AND B2
  - B1: Zero meaningful interactions (excluding family/online-only)
  - B2: Duration ≥3 months
- **C - Social support absence**: C1 AND C2
  - C1: Zero people to rely on (excluding family/online-only)
  - C2: Duration ≥3 months
- **D - Functional impairment**: (D1 OR D2) with duration ≥3 months each
  - D1: Emotional distress (score ≥5/10)
  - D2: Functional impairment (score ≥5/10)

## Project Structure

```
├── main.py                    # Streamlit landing page with flow overview
├── pages/
│   ├── chat.py               # Main interview chat interface
│   └── result.py             # Results analysis and visualization
├── interview/
│   ├── flow_engine.py        # LangGraph StateGraph implementation
│   ├── controller.py         # Centralized question management
│   ├── state_manager.py      # Interview state persistence
│   └── rule_engine.py        # JSON rule evaluation utilities
├── storage/
│   └── json_storage.py       # Results storage system
├── logs/
│   └── interview_logger.py   # Detailed logging for debugging
├── tests/
│   └── test_flow_scenarios.py # Scenario-based testing with LLM stubs
├── interview_flow.json       # Complete question/evaluation configuration
├── data/results/             # Stored interview results
└── references/               # Documentation and legacy configurations
```

## Development Notes

### Key Dependencies
- **LangGraph**: StateGraph for interview flow management
- **LangChain**: LLM integration with structured outputs
- **Streamlit**: Multi-page web interface
- **Gemini-2.5-flash**: Google's LLM for response evaluation
- **uv**: Python package management

### Testing
- Run `uv run python tests/test_flow_scenarios.py` for scenario-based testing
- Tests use stubbed LLM responses to validate flow logic
- Includes complete hikikomori/social isolation pathways

### Debugging
- Detailed logs stored in `logs/` directory with session IDs
- LLM calls, state changes, and evaluation results are logged
- Use `InterviewLogger` for consistent logging across components

### Important Implementation Details
- Uses **structured output** from Gemini with Pydantic models (`EvaluationOutput`)
- **Clarification logic** handles ambiguous responses automatically
- **Early termination** when A/B/C criteria are all negative (efficiency optimization)
- **Contradiction detection** prevents inconsistent evaluations
- **Memory persistence** with LangGraph MemorySaver for session continuity