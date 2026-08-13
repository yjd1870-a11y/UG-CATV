# CATV 업무관리 보안 배포 체크리스트

## 적용된 구조

- 인증은 서버 DB에 저장된 불투명 세션 토큰을 사용합니다. 브라우저에는 `HttpOnly`, `Secure`(운영), `SameSite` 쿠키만 저장됩니다.
- 모든 업무 API는 서버에서 활성 계정과 역할을 다시 확인합니다. 관리자 라우트는 `admin`만 접근할 수 있습니다.
- 신규 비밀번호는 bcrypt(cost 12)로 저장합니다. 기존 scrypt 해시는 정상 로그인 시 bcrypt로 자동 전환됩니다.
- CELL/B2C/직선도 검색은 바인딩 쿼리, 입력 길이, 결과 상한 및 요청 제한을 적용합니다.
- 현장 사진과 평면도는 공개 정적 폴더가 아니라 인증된 API를 통해서만 제공됩니다.
- 로그인 시도, 권한 거부, 관리자 변경, DB 업로드, 사진 업로드/삭제는 `audit_logs`에 기록됩니다.

## Vercel

- 공개 변수는 `VITE_API_URL`만 설정합니다. DB, 세션, 스토리지 Secret에 `VITE_` 접두사를 붙이지 않습니다.
- 권장 배포는 `/api`를 Render로 프록시해 브라우저 기준 동일 Origin을 유지하는 방식입니다. 이 경우 `SESSION_COOKIE_SAME_SITE=strict`를 유지할 수 있습니다.
- 브라우저가 Render를 직접 호출하면 Render에서 `SESSION_COOKIE_SAME_SITE=none`과 HTTPS를 사용하고, 정확한 Vercel 운영 도메인만 CORS에 등록합니다.
- Preview Origin은 `ADMIN_MUTATION_ALLOWED_ORIGINS`에서 제외해 운영 DB 변경을 차단합니다.

## Render

필수/권장 환경변수:

```text
NODE_ENV=production
SESSION_SECRET=
SESSION_COOKIE_NAME=__Host-catv_session
SESSION_COOKIE_SAME_SITE=strict
CORS_ALLOWED_ORIGINS=https://production.example.com
ADMIN_MUTATION_ALLOWED_ORIGINS=https://production.example.com
TRUST_PROXY=true
ENFORCE_HTTPS=true
DATABASE_PATH=/var/data/catv.sqlite
PRIVATE_STORAGE_PATH=/var/data
LOGIN_FAILURE_LIMIT=5
LOGIN_WINDOW_MINUTES=10
```

빈 DB를 처음 생성할 때만 `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`을 설정합니다. 최초 기동 후 세 변수를 제거하고 관리자 비밀번호를 다시 변경합니다.

SQLite와 로컬 비공개 사진을 계속 사용한다면 Render Persistent Disk를 `PRIVATE_STORAGE_PATH`에 연결하고 `DATABASE_PATH`도 같은 디스크 아래에 두어야 합니다. 임시 파일시스템에 배포하면 재배포 시 사진이 사라집니다.

## DB 변경과 백업

기동 시 다음 테이블이 자동 생성됩니다.

```text
login_attempts
audit_logs
```

대량 CELL/Excel 반영은 검증 ID를 발급한 관리자만 실행할 수 있고 단일 트랜잭션으로 커밋/롤백됩니다. 운영에서는 추가로 다음 정책을 적용합니다.

1. Persistent Disk 또는 관리형 DB의 일별 자동 스냅샷
2. Excel/대량 삭제 직전 수동 스냅샷
3. 백업 보존기간과 암호화 설정
4. 분기별 별도 환경 복구 테스트

## Cloudflare R2로 이전할 때

현재 구현은 기존 로컬 저장소를 비공개 API 뒤에 둡니다. 다중 인스턴스 또는 무상태 배포로 전환할 때는 R2를 다음과 같이 구성합니다.

- Bucket Public Access를 비활성화합니다.
- R2 Access Key/Secret은 Render에만 저장합니다.
- 객체 키는 사용자 파일명이 아닌 `photos/YYYY/MM/{uuid}.ext` 형태를 사용합니다.
- 조회 전 백엔드에서 사용자·역할·리소스 접근권한을 확인합니다.
- 다운로드는 5~15분짜리 presigned URL 또는 인증 백엔드 프록시를 사용합니다.
- R2 CORS에는 운영 프론트 Origin과 필요한 `GET`/`HEAD`만 허용합니다.

## GitHub

- Secret Scanning 및 Push Protection
- Dependabot Alerts 및 Security Updates
- 기본 브랜치 PR 필수, 승인 필수, 상태 검사(`lint`, `test:api`, `test:security`, `build`) 필수
- 관리자 우회/강제 푸시 제한
- `.env`, 키, 인증 JSON 파일 커밋 금지

이미 노출된 Secret을 발견하면 파일 삭제만으로 끝내지 말고 기존 Secret을 폐기한 뒤 새로 발급하고 Vercel/Render 값을 교체해야 합니다.

## 남은 운영 과제

- 일반 API rate limit은 현재 프로세스 메모리 기반이므로 다중 Render 인스턴스에서는 Redis/Cloudflare Rate Limiting으로 통합해야 합니다. 로그인 실패 잠금은 DB에 영속화됩니다.
- MFA는 아직 구현되지 않았습니다. 관리자 계정에는 IdP/OIDC 또는 TOTP MFA를 추가하는 것이 좋습니다.
- 현재 프로젝트는 SQLite입니다. PostgreSQL 전환 시 최소 권한 DB 계정, TLS, connection pool, statement timeout을 적용해야 합니다.
- 로컬 Git 메타데이터가 없어 과거 커밋의 Secret 노출 여부는 이 작업에서 확인하지 못했습니다. GitHub Secret Scanning 결과를 별도로 확인해야 합니다.
