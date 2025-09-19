"""인터뷰 결과를 JSON 파일로 저장하고 조회한다."""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class JSONStorage:
    """워크스페이스 내 JSON 파일 기반 저장소."""

    def __init__(self, storage_dir: str = "data"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(exist_ok=True)

        self.interviews_dir = self.storage_dir / "interviews"
        self.interviews_dir.mkdir(exist_ok=True)

        self.results_dir = self.storage_dir / "results"
        self.results_dir.mkdir(exist_ok=True)

        self.logger = logging.getLogger(__name__)

    def save_interview_state(self, state: Dict[str, Any]) -> bool:
        """LangGraph 상태를 그대로 저장한다 (디버그 용도)."""

        try:
            session_id = state["session_id"]
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            filename = f"interview_{session_id}_{timestamp}.json"
            filepath = self.interviews_dir / filename

            with open(filepath, "w", encoding="utf-8") as file:
                json.dump(self._make_serializable(dict(state)), file, ensure_ascii=False, indent=2)

            logger.info("Interview state saved: %s", filepath)
            return True

        except Exception as exc:  # pragma: no cover - 파일 오류는 런타임 로깅으로 충분
            logger.error("Error saving interview state: %s", exc)
            return False

    def save_interview_result(self, session_id: str, payload: Dict[str, Any]) -> bool:
        """완료된 인터뷰 결과 요약을 저장한다."""

        try:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            filename = f"result_{session_id}_{timestamp}.json"
            filepath = self.results_dir / filename

            result_payload = dict(payload)
            result_payload.setdefault("session_id", session_id)
            result_payload.setdefault("completed_at", datetime.utcnow().isoformat(timespec="seconds"))

            with open(filepath, "w", encoding="utf-8") as file:
                json.dump(self._make_serializable(result_payload), file, ensure_ascii=False, indent=2)

            logger.info("Interview result saved: %s", filepath)
            return True

        except Exception as exc:  # pragma: no cover
            logger.error("Error saving interview result: %s", exc)
            return False

    def load_interview_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        """세션 ID로 인터뷰 상태를 로드합니다."""
        try:
            # 가장 최근 파일 찾기
            pattern = f"interview_{session_id}_*.json"
            matching_files = list(self.interviews_dir.glob(pattern))

            if not matching_files:
                logger.warning(f"No interview state found for session: {session_id}")
                return None

            # 가장 최근 파일 선택
            latest_file = max(matching_files, key=os.path.getctime)

            with open(latest_file, 'r', encoding='utf-8') as f:
                state_data = json.load(f)

            logger.info(f"Interview state loaded: {latest_file}")
            return state_data

        except Exception as e:
            logger.error(f"Error loading interview state: {e}")
            return None

    def get_all_results(self) -> List[Dict[str, Any]]:
        """저장된 모든 인터뷰 결과를 반환합니다."""
        try:
            results = []

            for filepath in self.results_dir.glob("result_*.json"):
                with open(filepath, 'r', encoding='utf-8') as f:
                    result_data = json.load(f)
                    result_data['filepath'] = str(filepath)
                    results.append(result_data)

            # 날짜순 정렬 (최신 순)
            results.sort(key=lambda x: x.get('completed_at', ''), reverse=True)

            logger.info(f"Loaded {len(results)} interview results")
            return results

        except Exception as e:
            logger.error(f"Error loading all results: {e}")
            return []

    def get_result_by_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """세션 ID로 특정 결과를 반환합니다."""
        try:
            pattern = f"result_{session_id}_*.json"
            matching_files = list(self.results_dir.glob(pattern))

            if not matching_files:
                logger.warning(f"No result found for session: {session_id}")
                return None

            # 가장 최근 파일 선택
            latest_file = max(matching_files, key=os.path.getctime)

            with open(latest_file, 'r', encoding='utf-8') as f:
                result_data = json.load(f)
                result_data['filepath'] = str(latest_file)

            logger.info(f"Result loaded: {latest_file}")
            return result_data

        except Exception as e:
            logger.error(f"Error loading result by ID: {e}")
            return None

    def _create_result_summary(self, state: Dict[str, Any]) -> Dict[str, Any]:  # pragma: no cover - 구버전 호환
        """구버전 엔진과의 호환을 위해 유지."""
        return {
            "session_id": state["session_id"],
            "completed_at": datetime.utcnow().isoformat(timespec="seconds"),
            "final_diagnosis": state.get("final_diagnosis"),
            "criteria_results": state.get("criteria_results", {}),
            "question_results": state.get("question_results", {}),
            "conversation_history": state.get("conversation_history", []),
            "total_clarifications": sum(
                attempt for attempt in state.get("clarification_attempts", {}).values()
            ),
            "conversation_length": len(state.get("conversation_history", [])),
            "classification_result": state.get("final_diagnosis"),
            "metadata": {"version": "2.0.0", "created_by": "social-isolation-interview-agent"},
        }

    def _make_serializable(self, obj: Any) -> Any:
        """객체를 JSON 직렬화 가능한 형태로 변환합니다."""
        if isinstance(obj, dict):
            return {k: self._make_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._make_serializable(item) for item in obj]
        elif obj is None:
            return None
        else:
            return obj

    def export_results_csv(self, output_file: str) -> bool:
        """결과를 CSV 파일로 내보냅니다."""
        try:
            import pandas as pd

            results = self.get_all_results()
            if not results:
                logger.warning("No results to export")
                return False

            # CSV용 플랫 데이터 생성
            csv_data = []
            for result in results:
                criteria = result.get('criteria_results', {})
                csv_row = {
                    'session_id': result.get('session_id'),
                    'completed_at': result.get('completed_at'),
                    'final_diagnosis': result.get('final_diagnosis'),
                    'classification_result': result.get('classification_result'),
                    'A': criteria.get('A_overall', criteria.get('A')),
                    'B': criteria.get('B_overall', criteria.get('B')),
                    'C': criteria.get('C_overall', criteria.get('C')),
                    'D': criteria.get('D_overall', criteria.get('D')),
                    'conversation_length': result.get('conversation_length'),
                    'total_clarifications': result.get('total_clarifications')
                }
                csv_data.append(csv_row)

            df = pd.DataFrame(csv_data)
            df.to_csv(output_file, index=False, encoding='utf-8-sig')

            logger.info(f"Results exported to CSV: {output_file}")
            return True

        except ImportError:
            logger.error("pandas is required for CSV export")
            return False
        except Exception as e:
            logger.error(f"Error exporting to CSV: {e}")
            return False
