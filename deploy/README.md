# 고립 챗봇 서버 배포

개발은 로컬에서 하고, EC2는 GitHub `main`에 올라간 코드를 받아 실행만 합니다.
서버에 들어가 코드를 고치지 않습니다.

```
로컬: 개발 → 테스트 → git push → ./deploy/deploy.sh
                                      │ ssh
EC2:  git pull → docker compose up -d --build
      ┌────────────┐   /api/*   ┌──────────┐      ┌──────────────┐
  80 →│ web (Caddy)│ ─────────→ │ api      │ ───→ │ db (Postgres)│
 443  │ React 빌드  │            │ FastAPI  │      │ 외부 포트 없음  │
      └────────────┘            └──────────┘      └──────────────┘
```

`api` 컨테이너는 시작할 때마다 Alembic migration을 먼저 적용합니다. DB 데이터는
Docker volume(`dabom-server_postgres_data`)에 남아 재배포해도 지워지지 않습니다.

## 처음 한 번

1. **EC2를 만든다** (콘솔에서 직접). Ubuntu 24.04 LTS, `t3.small`, 디스크 20GB.
   보안 그룹은 22번은 내 IP만, 80·443은 전체 허용. 재시작해도 주소가 바뀌지
   않도록 Elastic IP를 붙인다.
2. **ssh 별칭을 만든다.** 로컬 `~/.ssh/config`:
   ```
   Host gorip
     HostName <Elastic IP>
     User ubuntu
     IdentityFile ~/.ssh/<키 파일>.pem
   ```
   `ssh gorip`으로 들어가지면 된다.
3. **배포 대상을 적는다.** `deploy/target.env` (git에 올라가지 않음):
   ```
   DEPLOY_HOST=gorip
   DEPLOY_URL=http://<Elastic IP>
   ```
4. **서버를 준비한다.** `./deploy/deploy.sh setup`
   Docker 설치, swap 2GB, GitHub deploy key 생성까지 하고 공개키를 보여 준다.
   그 키를 GitHub 저장소 → Settings → Deploy keys에 읽기 전용으로 등록한 뒤
   같은 명령을 한 번 더 실행하면 코드를 clone하고 `deploy/.env`를 만든다
   (DB 비밀번호는 서버에서 무작위로 생성).
5. **서버 설정을 채운다.** `ssh gorip` → `nano gorip-chatbot/deploy/.env`
   - `OPENAI_API_KEY`
   - `AUTH_ALLOWED_ORIGINS=http://<Elastic IP>` (브라우저 주소와 정확히 같아야 로그인된다)
   - `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` (10자 이상)
6. **배포한다.** `./deploy/deploy.sh` → 브라우저에서 접속해 첫 관리자로 로그인 →
   비밀번호 변경 → `deploy/.env`에서 `BOOTSTRAP_ADMIN_*` 두 줄 삭제.

## 그다음부터

```bash
git push
./deploy/deploy.sh
```

push하지 않은 commit이 있으면 배포를 거부합니다. 서버는 GitHub에 있는 것만 받기
때문입니다.

| 명령 | 하는 일 |
| --- | --- |
| `./deploy/deploy.sh` | pull, 이미지 빌드, 재시작, `/api/ready` 확인 |
| `./deploy/deploy.sh status` | 서버 컨테이너 상태 |
| `./deploy/deploy.sh logs api` | 서버 로그 따라 보기 (`api`, `web`, `db`) |
| `./deploy/deploy.sh backup` | DB dump를 로컬 `backups/`에 저장 |

DB가 EC2 안에 있는 동안은 자동 백업이 없습니다. 실제 참여자 데이터가 쌓이기
시작하면 `backup`을 주기적으로 실행하세요. dump에는 참여자 응답이 들어 있으므로
공유 폴더나 git에 두지 않습니다.

서버 DB를 직접 보려면 포트를 열지 말고 서버에서 실행합니다.

```bash
ssh -t gorip 'cd gorip-chatbot && docker compose -f deploy/compose.yaml exec db psql -U dabom dabom'
```

## 실제 참여자를 받기 전에

IP 주소로 접속하는 HTTP는 비밀번호와 응답이 암호화되지 않습니다. 테스트 데이터로만
쓰세요. 도메인을 서버 IP로 연결한 뒤 `deploy/.env`에서 세 줄을 바꾸고 다시
배포하면 Caddy가 HTTPS 인증서를 알아서 받고 갱신합니다.

```
SITE_ADDRESS=interview.example.org
AUTH_ALLOWED_ORIGINS=https://interview.example.org
AUTH_COOKIE_SECURE=true
```

## 나중에 바꿀 수 있는 것

- **RDS로 옮기기**: `deploy/.env`에서 `COMPOSE_PROFILES`와 `POSTGRES_PASSWORD`를
  지우고 `DATABASE_URL`을 RDS 주소로 바꾼다. `db` 컨테이너는 뜨지 않는다.
  기존 데이터는 `backup`으로 받은 dump를 RDS에 복원한다.
- **같은 인스턴스에 다른 앱 올리기**: 80·443은 이 앱의 Caddy가 쓰고 있으므로
  다른 앱은 다른 포트로 띄우거나, 도메인이 생기면 Caddy 하나가 서브도메인별로
  나눠 주게 한다. 이 앱의 포트는 `HTTP_PORT`, `HTTPS_PORT`로 바꿀 수 있다.
- **push만 하면 배포되게 하기**: GitHub Actions가 서버에 ssh로 들어와야 해서
  22번 포트를 전체에 열거나 SSM을 설정해야 한다. 혼자 개발하는 테스트 단계에서는
  `./deploy/deploy.sh` 한 줄이 더 안전하고 단순하다.
