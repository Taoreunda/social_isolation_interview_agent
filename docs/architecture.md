# Dabom 아키텍처

## 구성

```text
Browser
  -> HTTPS reverse proxy
    -> React static assets
    -> FastAPI
      -> PostgreSQL 16
      -> configured LLM provider
```

로컬은 Docker Compose PostgreSQL과 호스트 FastAPI/Vite를 사용합니다. AWS는 작은 단일 EC2 애플리케이션과 EC2에서만 접근 가능한 private RDS for PostgreSQL을 기본 구성으로 합니다. 로컬과 AWS는 같은 Alembic migration을 사용하며 애플리케이션 시작 전에 명시적으로 적용합니다.

## 역할과 접근 범위

### 참여자

- 로그인, 자동 로그인, 선택적 비밀번호 변경
- 본인의 현재 인터뷰 시작·재개와 공개 대화 조회
- 다른 참여자, 참여자 코드, 점수표, 진단, AI 근거, 전문가 검토와 CSV에는 접근 불가

### 관리자

- 가명 참여자 계정 생성, 비밀번호 재설정, 비활성화, 관리자 잠금 해제
- 인터뷰 목록·상세, 점수표 동의/변경과 CSV export
- 실명 대신 `participant_code` 사용

FastAPI가 각 요청에서 세션, 역할과 resource 소유권을 검사합니다. 참여자가 소유하지 않은 인터뷰는 `404`로 처리합니다. 상태 변경은 허용 origin과 double-submit CSRF cookie/header까지 검증합니다.

## 인증과 세션

사용자 이름은 정규화된 3–64자 ASCII이며 비밀번호는 10–128자입니다. 비밀번호는 Argon2id, 브라우저 세션은 암호학적으로 안전한 opaque token을 사용합니다. 브라우저에는 `HttpOnly`, `SameSite=Lax` session cookie를 두고 PostgreSQL에는 token hash만 저장합니다. HTTPS에서는 `Secure`를 적용합니다.

- 일반 세션: 생성 시점부터 고정 24시간
- 자동 로그인: 마지막 유효 활동 기준 30일 rolling 만료
- 자동 로그인 갱신: 만료 7일 이하일 때 현재 시점부터 30일로 연장
- 절대 상한: 최초 인증부터 90일
- `last_seen_at`: 쓰기를 15분 간격으로 제한
- 비밀번호 변경·재설정·비활성화·관리자 잠금/해제: 대상 계정의 모든 세션 폐기

로그인 실패는 두 단계입니다. 15분 안에 다섯 번 실패하면 15분 임시 잠금, 임시 잠금 종료 후 다시 15분 안에 다섯 번 실패하면 `admin_locked`가 됩니다. 임시 잠금 중 요청은 다음 단계 횟수에 포함하지 않습니다. 성공 로그인과 관리자 해제는 실패 단계를 초기화합니다.

## PostgreSQL 모델

Migration `20260904_0001`:

- `user_accounts`: 역할·상태·가명 코드, password hash, 로그인 실패/잠금 상태
- `auth_sessions`: token/CSRF hash, 일반·자동 세션 만료와 폐기 상태
- `audit_events`: 계정·검토·export 동작의 최소 metadata

Migration `20260905_0002`:

- `interviews`: 참여자, `active|completed|archived`, 진행률, 기준 결과, 진단·보고서, 알고리즘 버전과 시각
- `interview_messages`: 증가 순서, `user|assistant`, 공개 내용, `client_turn_id`
- `scorecard_items`: 문항 순서·텍스트, AI 상태·값·근거, clarification 횟수와 평가 시각
- `expert_reviews`: 문항별 최신 연구자 동의/변경 결과

UUID와 UTC timezone-aware timestamp를 사용합니다. partial unique index가 참여자당 활성 인터뷰 하나를 보장하고, `(interview_id, client_turn_id, role)`이 turn 재전송의 중복 메시지를 막습니다. 상태·진행률·문항 상태는 database check constraint로 제한합니다.

## 인터뷰 turn

1. 참여자 세션과 인터뷰 소유권을 확인합니다.
2. 같은 인터뷰의 겹치는 turn은 단일 프로세스 application lock으로 `409` 처리합니다.
3. PostgreSQL의 공개 메시지와 점수표를 읽어 기존 `InterviewEngine` 입력을 재구성합니다.
4. 열린 DB transaction 없이 LangGraph/LLM을 실행합니다.
5. 성공 시 user 메시지, assistant 메시지, 점수표와 인터뷰 상태를 한 transaction으로 커밋합니다.
6. 커밋된 `client_turn_id` 재전송은 모델을 다시 호출하지 않고 저장 결과를 반환합니다.

LLM 실패는 이전 커밋을 보존합니다. 서버 재시작 후에도 마지막 turn 경계부터 복원합니다. system prompt, tool call/message와 provider 객체는 저장하지 않습니다. 초기 인터뷰 생성은 process lock과 PostgreSQL advisory lock으로 직렬화됩니다.

모델이 기존 AI 판단을 바꾸면 해당 문항의 이전 전문가 검토를 무효화합니다. AI 상태가 `null`이면 검토할 수 없고 `recorded` 문항은 동의만 가능하며, 변경은 AI 판정과 다른 값이어야 합니다. 같은 값으로의 변경은 `400`으로 거부하고, 검토 UI는 `recorded` 행의 변경 버튼을 비활성화한 뒤 대화상자에서 유일하게 유효한 반대 판정을 기본 선택합니다. 검토 상태는 AI 판단이 존재하는 행만 대상으로 `unreviewed|in_review|reviewed`를 계산합니다.

## API 계약

참여자:

- `GET /api/interviews/current`
- `POST /api/interviews`
- `POST /api/interviews/{interview_id}/messages`

관리자:

- `GET /api/admin/interviews`
- `GET /api/admin/interviews/{interview_id}`
- `POST /api/admin/interviews/{interview_id}/scorecard/{question_id}`
- `POST /api/admin/interviews/{interview_id}/csv`

오류 의미는 `401` 인증 실패, `403` 역할·CSRF·origin 실패, `404` 보이지 않거나 없는 resource, `409` 상태/동시성 충돌, `503` DB·모델 dependency 실패입니다. 외부 exception 세부 정보는 응답에 포함하지 않습니다. CSV의 외부 유래 문자열은 spreadsheet formula 실행을 막도록 escape하며 export audit event를 남깁니다.

React의 `HttpAppApi`가 기본 구현입니다. 현재 인터뷰가 없다는 `404`에만 CSRF 보호된 생성 요청을 이어서 보냅니다. `VITE_APP_MODE=mock`은 격리된 UI 개발과 테스트에만 사용합니다. 옛 무인증 인터뷰 API, `MemorySaver`, JSON 결과 저장과 transcript logger는 애플리케이션에서 제거되었습니다.

## 운영 경계

- 초기 규모: 폐쇄형 참여자 약 200–300명, 소수 관리자, 한 연구
- 초기 runtime: 단일 FastAPI 프로세스; 여러 worker 전에 turn lock을 DB/분산 방식으로 교체
- 응답 방식: turn 완료 후 JSON; 부분 token streaming과 중단된 생성 복구는 미지원
- 데이터베이스: PostgreSQL만 지원; SQLite/JSON fallback 없음
- 계정: 공개 가입, 소셜 로그인, 이메일 인증/복구 없음
- 연구 관리: 인터뷰 archive 전환 UI/API는 아직 없음

AWS에서는 RDS 암호화, 자동 backup, 삭제 방지, private subnet, 최소 권한 security group, Secrets Manager/Parameter Store와 검증된 TLS를 사용합니다. FastAPI 구조화 로그는 CloudWatch Logs로 수집하되 메시지, 진단, 판단 근거, 비밀번호와 token을 기록하지 않습니다. LangSmith는 기본 비활성화하며 실제 연구 데이터 추적은 별도 승인 뒤에만 사용합니다.
