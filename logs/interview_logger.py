"""
Interview Logger
인터뷰 과정의 상세한 로깅을 위한 모듈
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class InterviewLogger:
    """인터뷰 과정을 상세히 로깅하는 클래스"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.logs_dir = Path("logs")
        self.logs_dir.mkdir(exist_ok=True)

        # 로그 파일 경로
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.log_file = self.logs_dir / f"interview_{session_id}_{timestamp}.json"

        # 로그 데이터
        self.logs = []
        self.session_start = datetime.now().isoformat()
        self._turn_counter = 0

        logger.info(f"Interview logger initialized for session {session_id}")
        logger.info(f"Log file: {self.log_file}")

    def log_turn(self,
                 node: str,
                 user_input: str,
                 llm_response: Any,
                 evaluation_result: Dict[str, Any] = None,
                 state_summary: Dict[str, Any] = None,
                 error: str = None):
        """인터뷰 턴의 상세 정보를 로깅"""

        self._turn_counter += 1

        turn_data = {
            "turn_number": self._turn_counter,
            "timestamp": datetime.now().isoformat(),
            "node": node,
            "user_input": user_input,
            "llm_response": str(llm_response) if llm_response else None,
            "evaluation_result": evaluation_result,
            "state_summary": state_summary,
            "error": error
        }

        self.logs.append(turn_data)

        # 콘솔 로그
        logger.info(f"=== TURN {turn_data['turn_number']} ===")
        logger.info(f"Node: {node}")
        logger.info(f"User Input: '{user_input}'")
        if llm_response:
            logger.info(f"LLM Response: {llm_response}")
        if evaluation_result:
            logger.info(f"Evaluation: {evaluation_result}")
        if error:
            logger.error(f"Error: {error}")
        logger.info("=== END TURN ===")

        # 파일에 저장
        self.save()

    def log_llm_call(self,
                     prompt: str,
                     user_input: str,
                     response: Any,
                     error: str = None,
                     attempt: int | None = None):
        """LLM 호출의 상세 정보를 로깅"""

        llm_call_data = {
            "timestamp": datetime.now().isoformat(),
            "type": "llm_call",
            "prompt": prompt[:500] + "..." if len(prompt) > 500 else prompt,
            "user_input": user_input,
            "response": str(response) if response else None,
            "error": error,
            "attempt": attempt
        }

        self.logs.append(llm_call_data)

        logger.info(f"=== LLM CALL ===")
        logger.info(f"User Input: '{user_input}'")
        logger.info(f"Prompt (first 200 chars): {prompt[:200]}...")
        logger.info(f"Response: {response}")
        if error:
            logger.error(f"LLM Error: {error}")
        if attempt is not None:
            logger.info(f"Attempt: {attempt}")
        logger.info("=== END LLM CALL ===")

        self.save()

    def log_state_change(self,
                        from_node: str,
                        to_node: str,
                        reason: str,
                        state_data: Dict[str, Any] = None):
        """상태 변경을 로깅"""

        state_change_data = {
            "timestamp": datetime.now().isoformat(),
            "type": "state_change",
            "from_node": from_node,
            "to_node": to_node,
            "reason": reason,
            "state_data": state_data
        }

        self.logs.append(state_change_data)

        logger.info(f"State Change: {from_node} -> {to_node} ({reason})")

        self.save()

    def save(self):
        """로그를 파일에 저장"""
        try:
            log_data = {
                "session_id": self.session_id,
                "session_start": self.session_start,
                "last_updated": datetime.now().isoformat(),
                "total_turns": self._turn_counter,
                "logs": self.logs
            }

            with open(self.log_file, 'w', encoding='utf-8') as f:
                json.dump(log_data, f, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"Failed to save log file: {e}")

    def get_summary(self) -> Dict[str, Any]:
        """세션 요약 정보를 반환"""
        turns = [log for log in self.logs if log.get("turn_number")]
        llm_calls = [log for log in self.logs if log.get("type") == "llm_call"]
        errors = [log for log in self.logs if log.get("error")]

        return {
            "session_id": self.session_id,
            "total_turns": len(turns),
            "total_llm_calls": len(llm_calls),
            "total_errors": len(errors),
            "last_node": turns[-1]["node"] if turns else None,
            "session_duration_minutes": self._get_session_duration(),
            "log_file": str(self.log_file)
        }

    def _get_session_duration(self) -> float:
        """세션 지속 시간을 분 단위로 반환"""
        try:
            start = datetime.fromisoformat(self.session_start)
            now = datetime.now()
            duration = (now - start).total_seconds() / 60
            return round(duration, 2)
        except:
            return 0.0
