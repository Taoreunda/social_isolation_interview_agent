# 연구 플랫폼 목표 아키텍처

이 문서는 Dabom의 유지되는 목표 아키텍처입니다. 현재 구현과 목표 상태를 구분하며, 세부 구현과 데이터베이스 migration이 최종 동작의 기준입니다.

## 현재 구현 상태

| 영역 | 현재 | 목표 |
| --- | --- | --- |
| 프론트엔드 | 역할이 분리된 React/shadcn 목 UI | 인증된 FastAPI API와 연결 |
| 인증 | 브라우저 fixture 세션 | PostgreSQL 기반 서버 세션 |
| 인터뷰 백엔드 | 인증 없는 FastAPI/LangGraph 프로토타입 | 역할·소유권이 적용된 동일 FastAPI 서비스 |
| 영속성 | 프로세스 메모리와 gitignored JSON | PostgreSQL 16, AWS에서는 RDS for PostgreSQL |
| 배포 | 로컬 개발 | 작은 EC2 애플리케이션 호스트 + private Single-AZ RDS |

현재 목 UI와 FastAPI 프로토타입은 함께 실행할 수 있지만 서로 호출하지 않습니다. 인증, 권한 검사, PostgreSQL 저장 및 제한된 CORS가 구현되기 전에는 실제 연구 데이터를 입력하지 않습니다.

## 결정된 범위

- 약 200–300명의 폐쇄형 참여자와 소수의 연구 관리자를 지원합니다.
- 역할은 `participant`와 `admin` 두 개뿐입니다.
- 공개 가입, 소셜 로그인, 이메일 인증, 비밀번호 복구 메일은 만들지 않습니다.
- 최초 로그인 시 비밀번호 변경을 강제하지 않습니다.
- 한 연구만 지원하며 조직·tenant 분리는 도입하지 않습니다.
- PostgreSQL 기능만 사용하고 SQLite나 JSON fallback을 두지 않습니다.
- 초기 배포는 단일 FastAPI 프로세스와 Single-AZ RDS로 시작합니다. 수평 확장, Redis, RDS Proxy, read replica와 Multi-AZ는 부하 및 운영 요구가 생길 때 검토합니다.

## 실행 구조

```text
Browser
  -> HTTPS reverse proxy
    -> React static assets
    -> FastAPI REST/SSE API
      -> PostgreSQL
      -> configured LLM provider
```

로컬과 AWS는 같은 PostgreSQL major version과 migration을 사용합니다.

- 로컬: 컨테이너 PostgreSQL 16, 호스트의 FastAPI와 Vite
- AWS: 정적 React build와 FastAPI를 실행하는 작은 EC2, EC2 보안 그룹에서만 접근 가능한 private RDS
- `DATABASE_URL`로 연결 대상을 선택하고 AWS 연결은 TLS 인증서를 검증합니다.
- migration은 Alembic으로 명시적으로 실행하며 애플리케이션 시작 시 자동 적용하지 않습니다.
- 데이터베이스 연결 실패는 readiness 실패로 처리하고 다른 저장 방식으로 전환하지 않습니다.

AWS 인스턴스 크기는 동시 사용자 부하 시험 뒤 확정합니다. 초기 구성에는 RDS 암호화, 자동 backup, 삭제 방지, private subnet과 최소 권한 security group을 적용합니다. 데이터베이스 자격 증명은 Secrets Manager 또는 Parameter Store에서 제공합니다.

## 역할과 데이터 경계

### 참여자

- 로그인, 자동 로그인, 현재 인터뷰 시작·재개, 선택적 비밀번호 변경
- 자신의 활성 인터뷰와 공개된 대화 메시지만 접근
- 진단, 점수표, AI 판단, 연구자 근거, 다른 참여자 및 export에는 접근 불가

### 관리자

- 참여자 계정 생성·비활성화·비밀번호 재설정·관리자 잠금 해제
- 인터뷰 목록·상세 조회, 점수표 동의·변경, CSV export
- 실명 대신 가명 `participant_code` 사용

브라우저 route guard는 탐색 편의 기능입니다. FastAPI가 모든 요청에서 세션, 역할과 resource 소유권을 다시 검사합니다. 보이지 않는 resource는 필요에 따라 `404`로 응답해 존재 여부를 노출하지 않습니다.

참여자는 하나의 활성 인터뷰만 가질 수 있습니다. 과거 시도는 보관할 수 있지만, 활성 인터뷰의 archive와 교체는 관리자만 수행합니다. 참여자는 수집된 연구 데이터를 삭제하거나 초기화할 수 없습니다.

## 인증과 세션

- 사용자 이름은 trim·정규화 후 3–64자의 소문자 ASCII `a-z`, 숫자, `.`, `_`, `-`만 허용합니다.
- 비밀번호는 10–128자이며 Argon2id로 hash합니다.
- 관리자는 계정 생성·재설정 시 비밀번호를 직접 입력하거나 16자 이상의 안전한 값을 생성할 수 있습니다.
- 평문 비밀번호는 해당 응답에서 한 번만 반환하고 저장하거나 로그로 남기지 않습니다.
- 첫 관리자는 로컬 shell 또는 AWS Systems Manager에서 실행하는 대화형 관리 명령으로 생성합니다.
- 로그인 실패 메시지는 사용자 이름의 존재 여부를 구분하지 않습니다.

로그인 실패는 두 단계로 처리합니다.

1. 15분 안에 다섯 번 실패하면 15분 동안 임시 잠급니다.
2. 임시 잠금 중 발생한 요청은 다음 단계의 실패 횟수에 포함하지 않습니다.
3. 임시 잠금이 끝난 뒤 다시 15분 안에 다섯 번 실패하면 `admin_locked` 상태로 전환합니다.
4. `admin_locked` 계정은 관리자만 해제할 수 있습니다. 해제는 실패 횟수와 잠금 단계를 초기화하고 기존 세션을 복구하지 않습니다.
5. 임시 잠금 이후 정상 로그인에 성공하면 실패 횟수와 잠금 단계를 초기화합니다.
6. 관리자 잠금과 해제는 모든 기존 세션을 폐기하고 audit event를 기록합니다.

로그인 성공 시 암호학적으로 안전한 opaque token을 생성합니다. 브라우저에는 `HttpOnly`, `SameSite=Lax` cookie만 전달하고 production에서는 `Secure`를 추가합니다. PostgreSQL에는 token hash만 저장합니다.

- 일반 세션: 생성 시점부터 24시간의 고정 만료. 활동으로 연장하지 않음
- 자동 로그인 세션: 마지막 유효 활동을 기준으로 30일의 rolling 만료
- 자동 로그인 갱신: 만료까지 7일 이하로 남았을 때 인증된 요청이 성공하면 만료를 현재 시점부터 30일로 연장
- 자동 로그인 절대 상한: 최초 인증 시점부터 90일. 상한에 도달하면 다시 로그인해야 함
- 새로 로그인하면 기존 세션을 연장하지 않고 새로운 만료 기준의 세션을 생성
- 로그아웃: 현재 세션 폐기
- 비밀번호 변경·관리자 재설정·계정 비활성화·관리자 잠금: 해당 계정의 모든 세션 폐기
- 만료·폐기 세션: 주기적인 정리 명령으로 삭제

`last_seen_at` 갱신은 요청마다 쓰지 않고 일정 간격으로 제한합니다. rolling 연장 여부는 서버가 계산하며 client cookie만으로 만료를 늘릴 수 없습니다.

상태 변경 요청은 허용된 origin과 CSRF token을 검증합니다. CORS는 개발·production 각각의 애플리케이션 origin으로 제한합니다.

## PostgreSQL 모델

식별자는 UUID, 시각은 UTC timezone-aware timestamp를 사용합니다. 상태 값에는 데이터베이스 constraint를 둡니다.

### `user_accounts`

- 정규화·표시 사용자 이름, password hash, `participant|admin` 역할, `active|disabled|admin_locked` 상태
- 참여자에게만 존재하는 unique `participant_code`
- 실패 window 시작 시각과 횟수, `temporary_locked_until`, 잠금 단계
- `admin_locked_at`, 잠금·해제 관리자와 해제 시각
- 생성자와 생성·수정·비밀번호 변경 시각

### `auth_sessions`

- 사용자, token hash, session 종류, 생성·최근 사용·rolling 만료·절대 만료·폐기 시각

### `interviews`

- 참여자, `active|completed|archived` 상태와 주요 시각
- 진단·보고서·알고리즘 버전
- 참여자당 활성 인터뷰 하나를 보장하는 unique rule

### `interview_messages`

- 인터뷰별 증가하는 순서, `user|assistant` 역할, 내용과 생성 시각
- 한 요청에서 생성된 메시지가 공유하는 `client_turn_id`
- `(interview_id, client_turn_id, role)` unique key

화면에 보이는 사용자·assistant 메시지만 연구 기록으로 저장합니다. system prompt, tool payload와 provider 전용 객체는 대화 기록으로 저장하지 않습니다.

### `scorecard_items`

- 인터뷰·문항 unique key
- AI 상태, 추출 값, 근거, clarification 횟수와 평가 시각

### `expert_reviews`

- 인터뷰, 문항, 검토자
- 원래 상태, 전문가 상태, 근거, 동작과 검토 시각
- 인터뷰·문항당 최신 검토를 식별할 수 있는 constraint

### `audit_events`

- actor, action, target 종류·ID, 시각과 최소 metadata
- 계정 생성·비활성화·재설정·잠금·해제, 인터뷰 archive, 전문가 변경과 export 기록
- 대화 내용, 비밀번호, token, 진단은 중복 기록하지 않음

여러 연구를 실제로 운영하기 전에는 `studies` 테이블을 추가하지 않습니다.

## 인터뷰 transaction

각 참여자 turn은 client가 생성한 `client_turn_id`를 포함합니다.

1. 세션과 인터뷰 소유권을 검증합니다.
2. 동일 인터뷰의 동시 요청을 거부합니다.
3. 커밋된 메시지와 점수표를 불러와 LangGraph 입력을 재구성합니다.
4. LLM을 실행하고 임시 assistant token을 SSE로 전달합니다.
5. 사용자 메시지, 최종 assistant 메시지, 점수표와 인터뷰 metadata를 한 transaction으로 저장합니다.
6. transaction commit 이후에만 SSE `done`을 보냅니다.

초기 단일 프로세스에서는 인터뷰별 application lock으로 겹치는 turn을 `409` 처리합니다. 다중 프로세스로 확장하기 전에는 database 또는 분산 lock으로 교체해야 합니다.

LLM 실패 시 이전 커밋 상태를 유지합니다. commit 실패 시 UI는 마지막 커밋 상태를 다시 불러옵니다. 이미 커밋된 `client_turn_id`를 재전송하면 메시지를 추가하지 않고 저장된 결과를 반환합니다. 이를 통해 FastAPI 재시작 뒤에도 turn 경계에서 인터뷰를 재개할 수 있습니다. 중단된 LLM 응답의 부분 token 복구는 범위 밖입니다.

## API 계약

공개 endpoint는 health/readiness와 login으로 제한합니다. 나머지는 유효한 서버 세션이 필요합니다.

- 참여자 API: 현재 계정, 비밀번호 변경, 현재 인터뷰, 메시지 stream과 최종 커밋 상태
- 관리자 API: 참여자 계정·잠금 해제, 인터뷰 목록·상세·archive, 점수표 검토, CSV export

참여자용 인터뷰 응답에는 진행 상태와 공개 메시지만 포함합니다. `participant_code`, 검토 상태, 점수표, AI 상태와 근거는 관리자 DTO에만 포함합니다.

오류 의미는 다음과 같이 고정합니다.

- `401`: 인증 없음·만료·폐기. 프론트엔드 세션을 지우고 로그인으로 이동
- `403`: 유효한 사용자지만 권한 없음. 세션은 유지하고 권한 전용 상태 표시
- `404`: 호출자에게 보이지 않는 resource
- `409`: 활성 인터뷰 또는 동시 turn 충돌
- `503`: PostgreSQL 등 필수 dependency 사용 불가

SSE 오류는 안정적인 machine-readable code와 안전한 한국어 메시지를 사용합니다. 원본 exception과 database 세부 정보는 client에 반환하지 않습니다.

AI 상태가 `null`인 점수표 행은 검토할 수 없으며 동의와 변경을 모두 거부합니다. 인터뷰 검토 상태는 AI 상태가 non-null인 행만 대상으로 계산합니다.

- 검토된 행 없음: `unreviewed`
- 일부만 검토: `in_review`
- 모든 검토 가능 행 완료: `reviewed`

CSV export는 참여자 코드를 사용하고 audit event를 남깁니다. spreadsheet formula injection을 막도록 외부 유래 cell을 escape합니다.

## 프론트엔드 계약

유지하는 경로는 다음과 같습니다.

- `/login`
- `/interview`
- `/account/password`
- `/admin`
- `/admin/participants`
- `/admin/interviews/:interviewId`

역할 전환 UI는 두지 않습니다. 참여자 shell은 인터뷰와 계정 동작만, 관리자 shell은 참여자 관리와 인터뷰 검토만 제공합니다. UI 원칙과 세 가지 기본 색상은 [PRODUCT.md](../PRODUCT.md)를 따릅니다.

현재 목 데이터는 `frontend/src/mocks/` 안에만 존재합니다. 실제 API 연결 시 `AppApi` 계약 뒤의 구현을 교체하고 별도의 browser persistence를 추가하지 않습니다.

현재 목과 목표의 차이는 다음 API 연결 단계에서 제거합니다.

- 목 비밀번호 변경은 화면 흐름 검증을 위해 로그인 상태를 유지하지만 실제 API는 모든 세션을 폐기합니다.
- 모든 보호 작업의 `403`을 공통 권한 상태로 표시합니다.
- AI 상태가 null인 행의 검토와 review-status 계산을 목표 계약에 맞춥니다.

## 개인정보와 운영

- 로그에는 request ID와 운영 metadata만 남기고 메시지, 판단 근거, 비밀번호, token과 진단을 기록하지 않습니다.
- LangSmith 추적은 기본으로 끕니다. 실제 참여자 데이터 추적은 별도의 연구 데이터 승인 뒤에만 사용합니다.
- raw database와 backup 접근은 배포 환경의 연구 관리자에게만 허용합니다.
- backup 보존 기간과 최종 삭제는 승인된 연구 protocol을 따릅니다.
- production Vite 개발 서버와 public PostgreSQL port를 허용하지 않습니다.

## 다음 구현 순서

1. PostgreSQL 설정, 로컬 Compose, SQLAlchemy 모델·repository와 Alembic migration을 추가합니다.
2. 비밀번호·rolling 세션 service, 2단계 로그인 잠금, 관리자 잠금 해제, 최초 관리자 명령, login/logout, CSRF와 역할 dependency를 구현합니다.
3. 인터뷰, 메시지, 점수표, 검토와 export를 repository로 옮깁니다.
4. React `AppApi`를 인증된 endpoint에 연결하고 위의 목 차이를 제거합니다.
5. 기존 `_sessions`, `MemorySaver` checkpoint 의존, JSON storage와 transcript logging을 활성 경로에서 제거하고 CORS를 제한합니다.
6. 로컬 복구·동시성 검증 뒤 EC2/RDS 배포 설정을 추가합니다.

## 연구 사용 전 통과 조건

- 빈 PostgreSQL에 모든 migration을 적용하고 첫 관리자를 생성할 수 있습니다.
- 24시간 일반 세션, 30일 rolling·90일 상한 자동 로그인, 갱신 임계점과 만료 테스트가 통과합니다.
- 첫 5회 실패의 임시 잠금, 다음 5회의 관리자 잠금, 성공 초기화, 관리자 해제와 세션 폐기 테스트가 통과합니다.
- 로그인·로그아웃·CSRF와 generic 로그인 오류 테스트가 통과합니다.
- 참여자와 관리자가 상대 역할의 route와 데이터에 접근할 수 없습니다.
- 중복 turn, LLM 실패, database 실패와 FastAPI 재시작 뒤 마지막 커밋 상태가 유지됩니다.
- 활성 endpoint가 `_sessions`, `MemorySaver` 또는 JSON 결과 파일을 읽거나 쓰지 않습니다.
- frontend route·상태 테스트와 desktop/360px 브라우저 smoke test가 통과합니다.
- 실제 export 전에 CSV formula-injection 테스트가 통과합니다.
- backup 복원 연습과 예상 동시 사용자 부하 시험을 완료합니다.
- 같은 migration과 애플리케이션 build가 로컬 PostgreSQL과 RDS에서 동작합니다.
