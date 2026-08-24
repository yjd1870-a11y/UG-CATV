# CATV 업무관리 시스템

Vite + React 화면을 유지하면서 Express API와 SQLite 데이터베이스를 같은 로컬 서버에 결합한 CATV/HFC 현장업무 관리 시스템입니다.

## 직선도 지도 파이프라인

- 브라우저가 XLSX SHA-256을 계산해 원본을 R2 `line-diagrams/v3/sources/`로 직접 업로드합니다.
- Windows Excel Agent가 실제 값/수식 셀과 표시 도형만 찾아 18pt 여백의 벡터 PDF와 PDF point 좌표를 생성합니다.
- 시트별 `map.pdf`, `coordinates.json`, `manifest.json` 3개만 R2에 올리며 타일 PUT은 발생하지 않습니다.
- 새 버전이 완료되기 전에는 기존 `ACTIVE` 버전을 유지하고, 완료 시에만 이전 버전을 `ARCHIVED`로 전환합니다.
- CELL/B2C 직선도는 PDF.js 지도 뷰어로 연결되며 화면 교차 페이지만 확대 배율·DPR에 맞춰 렌더링하고 검색 위치로 자동 이동합니다.

## 1. 분석한 기존 프로젝트 구조

- 프론트엔드: React 19, TypeScript, Vite 6, Tailwind CSS 4
- 기존 백엔드: 없음 (`express` 의존성만 설치돼 있었음)
- 기존 저장 방식: `src/data/mockData.ts` 하드코딩 데이터와 브라우저 `localStorage`
- 기존 화면: 로그인, 홈, CELL 목록/상세, 국사/HFC/직선도/사진/작업이력, 업무이관, 일일업무, 자재사용
- 기존 API 호출: 없음
- Excel/CSV 직접 사용: 없음
- 환경변수: AI Studio 예시만 있었으며 실제 업무 DB 환경변수는 없었음

구조를 대규모로 재편하지 않고 기존 `src` UI는 유지하고 `backend`와 `src/services`만 추가했습니다.

```text
CATV 업무관리/
├─ backend/
│  ├─ data/                 # 로컬 SQLite DB(버전관리 제외)
│  ├─ routes/               # 업무별 Express API
│  ├─ security/             # 비밀번호 해시와 HttpOnly 세션
│  ├─ tests/                # API 통합 테스트
│  ├─ app.ts                # API 앱 조립
│  ├─ db.ts                 # 스키마, 인덱스, 초기 데이터 이관
│  ├─ env.ts                # 환경변수
│  ├─ init-db.ts            # DB 초기화 명령
│  └─ server.ts             # Vite + Express 통합 서버
├─ scripts/
│  └─ import-data.ts        # CSV/JSON CELL 데이터 이관
├─ src/
│  ├─ components/           # 기존 UI + 관리자 승인 화면
│  ├─ context/AppContext.tsx
│  └─ services/api.ts       # 공통 API 클라이언트
└─ .env.example
```

## 2. 새로 생성한 파일

- `backend/env.ts`: 서버/DB/세션 환경변수 로딩
- `backend/db.ts`: 관계형 스키마, FK, 인덱스, 초기 샘플 데이터 시드
- `backend/http.ts`: 성공/실패 응답과 입력 검증, 공통 오류 처리
- `backend/mappers.ts`: DB 레코드를 기존 프론트 타입으로 변환
- `backend/security/password.ts`: Node `scrypt` 비밀번호 해시/검증
- `backend/security/session.ts`: 무작위 세션 토큰, HMAC 해시, HttpOnly 쿠키, 권한 미들웨어
- `backend/routes/auth.ts`: 가입/로그인/로그아웃/내 정보
- `backend/routes/admin.ts`: 가입 승인/비활성화
- `backend/routes/cells.ts`: CELL 검색/상세/CRUD/사진/작업이력
- `backend/routes/work-transfers.ts`: 업무이관 조회/등록/상태 변경
- `backend/routes/daily-work.ts`: 일일업무 조회/저장/수정/삭제
- `backend/routes/materials.ts`: 자재 마스터/사용내역/재고 트랜잭션
- `backend/app.ts`, `backend/server.ts`: API와 Vite 통합 실행
- `backend/init-db.ts`: DB 초기화 진입점
- `backend/tests/api.integration.ts`: 전체 저장 흐름 자동 테스트
- `src/services/api.ts`: 브라우저 공통 API 호출 계층
- `src/components/admin/AdminUsersView.tsx`: 관리자 가입 승인 화면
- `scripts/import-data.ts`: CSV/JSON 중복 방지 CELL 이관

## 3. 주요 수정 파일

- `src/context/AppContext.tsx`: mock/localStorage 업무 저장을 Backend API 저장으로 교체
- `src/components/auth/LoginView.tsx`: DB 로그인, 회원가입, 승인 상태 오류 메시지 연결
- `src/components/cell/CellList.tsx`: 300ms 지연 검색 API, 로딩/빈 결과/오류 UI
- `src/components/transfer/TransferList.tsx`: 서버 권한과 맞춰 팀장/관리자만 신규 등록 표시
- `src/components/common/Header.tsx`: 관리자 가입 승인 진입 버튼
- `src/App.tsx`, `src/types.ts`: 세션 확인 로딩과 관리자 화면 라우팅
- `package.json`: 통합 개발 서버, DB 초기화, API 테스트, 데이터 이관 명령 추가
- `.env.example`, `.gitignore`: DB/세션/스토리지 설정과 민감 파일 제외

## 4. DB 테이블과 관계

| 테이블 | 용도 | 주요 관계 |
|---|---|---|
| `users` | 계정, 사번, 부서, 권한, 승인 상태 | 일일업무/자재사용/세션의 부모 |
| `auth_sessions` | 해시된 세션 토큰과 만료시각 | `users` 삭제 시 함께 정리 |
| `sites` | 국사, 층, 랙 정보 | `cells.site_id`에서 RESTRICT |
| `cells` | CELL명/코드/노드/주소/상태 | 국사, 선번, 사진, 업무와 연결 |
| `transmission_lines` | 선번/송수신기/장비정보 | `cells` 삭제 RESTRICT |
| `field_photos` | 사진 URL/경로와 메타데이터 | 사진 바이너리는 DB에 저장하지 않음 |
| `cell_work_history` | CELL 작업이력 | `cells` 삭제 RESTRICT |
| `work_transfers` | 업무이관 본문/상태/담당자 | CELL 및 사용자 FK |
| `work_transfer_logs` | 상태 변경 이력 | 업무이관 삭제 시 함께 정리 |
| `daily_work` | 날짜/사용자/CELL/작업 집계 | 사용자 및 CELL FK |
| `materials` | 자재 마스터/현재 재고/최소 재고 | 사용내역의 부모 |
| `material_usage` | 자재 사용량/목적/작업 | 자재·사용자·CELL FK |
| `catv_cells` | 전송망 CELL 검색/상세 원본 | 기존 업무 `cells`와 분리, 키번호 인덱스 |
| `catv_b2c_lines` | B2C 서비스/노드/선번/검색값 | 업로드 원본 파일명을 함께 보존 |
| `catv_floor_plans` | 국사 평면도 파일 메타데이터 | 실제 이미지는 파일 저장소, DB에는 `object_key`만 저장 |
| `catv_floor_plan_coordinates` | 노드/Rack 비율 좌표 | 평면도 삭제 시 함께 정리 |

`cells.cell_name`, `cell_code`, `node_name`, `site_id`와 주요 조회/관계 컬럼에 인덱스를 적용했습니다. CELL, 국사, 선번, 사진, 일일업무는 soft delete 또는 `ON DELETE RESTRICT`를 사용하여 실수로 연관 업무가 삭제되지 않게 했습니다.

## 5. API 목록

모든 응답은 `{ "success": true, "data": ... }` 또는 `{ "success": false, "message": "..." }` 형식입니다.

### 인증/관리자

| Method | URL | 기능 |
|---|---|---|
| POST | `/api/auth/signup` | `pending` 상태 회원가입 |
| POST | `/api/auth/login` | 비밀번호/승인 상태 확인 후 HttpOnly 세션 발급 |
| POST | `/api/auth/logout` | 세션 폐기 |
| GET | `/api/auth/me` | 현재 로그인 사용자 |
| GET | `/api/admin/users?status=pending` | 상태별 사용자 조회(admin) |
| PUT | `/api/admin/users/:id/approve` | 가입 승인(admin) |
| PUT | `/api/admin/users/:id/disable` | 사용자 비활성화(admin) |

### CELL/업무

| Method | URL | 기능 |
|---|---|---|
| GET | `/api/cells` | CELL 페이지 목록 |
| GET | `/api/cells/search?name=오산` | CELL명/코드/노드 부분검색 |
| GET | `/api/cells/search?q=G100000` | 전송망 CELL DB 서버 검색(최대 50건) |
| GET | `/api/cells/:id/transmission` | 전송망 CELL 상세 |
| GET | `/api/b2c/search?q=주소` | B2C 서비스명/주소/비고/노드 서버 검색 |
| GET | `/api/b2c/:id` | B2C 상세 및 동일 국사 CELL 주소 결합 |
| GET | `/api/floor-plans/search?station=...&target=...&type=node` | 정규화된 국사명과 노드/Rack 좌표 검색 |
| GET | `/api/floor-plans/:id/image` | 로그인 사용자용 평면도 이미지 스트리밍 |
| GET | `/api/cells/:id` | 국사·선번·사진·업무·자재 포함 상세 조회 |
| POST/PUT/DELETE | `/api/cells`, `/api/cells/:id` | CELL 관리(admin) |
| POST | `/api/cells/:id/photos` | 현장사진 URL 메타데이터 등록 |
| POST/PUT/DELETE | `/api/cells/:id/history...` | CELL 작업이력 CRUD |
| GET/POST | `/api/work-transfers` | 업무이관 조회/등록(manager, admin 등록) |
| PUT | `/api/work-transfers/:id` | 업무 상태/내용 변경 |
| GET/POST | `/api/daily-work` | 권한 범위 내 일일업무 조회/저장 |
| PUT/DELETE | `/api/daily-work/:id` | 일일업무 수정/soft delete |
| GET/POST | `/api/materials` | 자재 조회/관리(admin 등록) |
| GET/POST | `/api/material-usage` | 자재사용 조회/재고 차감 저장 |

## 6. 데이터 저장 방법

- 회원가입: 로그인 카드 회원가입 → `POST /api/auth/signup` → `scrypt` 비밀번호 해시 → `users(status=pending)` 저장
- 관리자 승인: 승인 화면 → `PUT /api/admin/users/:id/approve` → `active` 전환
- 로그인: `POST /api/auth/login` → 해시 비교 → 상태 확인 → DB 세션 생성 → HttpOnly/SameSite 쿠키
- 일일업무/업무이관/작업이력: 기존 저장 버튼 → API → SQLite 저장 → API 응답으로 화면 상태 갱신
- 자재사용: 트랜잭션 시작 → 재고 조건부 차감 → 사용내역 INSERT → 성공 시 COMMIT, 재고 부족/오류 시 ROLLBACK

프론트엔드는 SQLite 파일을 직접 열지 않으며 항상 `Frontend → Backend API → SQLite` 경로를 사용합니다.

## 7. CELL 조회 방법

전송망 CELL/B2C 조회는 검색 버튼을 누른 시점에만 서버 API를 호출합니다. 브라우저로 전체 DB를 내려받거나 `localStorage`에서 필터링하지 않습니다. 결과가 1건이면 상세를 즉시 표시하고, 2건 이상이면 국사·주소·Rack 정보를 포함한 선택 목록을 표시합니다.

평면도 이동은 `station + target + type(node/rack)`을 서버에 전달합니다. 서버는 `기남_송탄국사`, `송탄국사`, `송탄`을 같은 국사 키로 정규화하고, DB에 저장된 `x_ratio`/`y_ratio`를 반환합니다. 이미지는 DB base64가 아니라 `object_key`가 가리키는 파일 저장소에서 필요한 국사의 한 장만 스트리밍합니다.

## 8. 실행 방법

필수 환경: Node.js 22.5 이상(Node 내장 SQLite 사용, 현재 검증 환경 Node 24)

```powershell
npm install
Copy-Item .env.example .env
npm run db:init
npm run dev
```

브라우저: `http://localhost:3000`

`npm run dev` 하나가 Express API와 Vite 프론트엔드를 함께 실행합니다. API만 별도 실행하려면 `npm run dev:backend`를 사용하며 기본 주소는 `http://localhost:3001`입니다.

초기 개발 계정(개발 모드의 초기 DB에만 사용):

- 작업자: `user-1` / `1234`
- 팀장: `user-4` / `1234`
- 관리자: `user-5` / `1234`

운영 모드에서는 위 개발 계정을 생성하지 않습니다. 빈 운영 DB는 `BOOTSTRAP_ADMIN_*` 환경변수로 최초 관리자 1명만 생성하며, 생성 직후 해당 환경변수를 제거하고 비밀번호를 교체해야 합니다.

## 9. 환경변수

| 변수 | 설명 |
|---|---|
| `PORT` | 통합 웹/API 포트 |
| `NODE_ENV` | `development` 또는 `production` |
| `DATABASE_PATH` | SQLite 파일 경로 |
| `PRIVATE_STORAGE_PATH` | 인증 API 뒤의 사진/평면도 저장 루트 |
| `SESSION_SECRET` | 세션 토큰 HMAC 비밀값(운영 필수) |
| `SESSION_TTL_HOURS` | 세션 만료 시간 |
| `SESSION_COOKIE_NAME` | HttpOnly 쿠키 이름 |
| `SESSION_COOKIE_SAME_SITE` | 세션 쿠키 SameSite 정책(`strict`, `lax`, `none`) |
| `CORS_ALLOWED_ORIGINS` | 허용할 프론트엔드 Origin 목록 |
| `ADMIN_MUTATION_ALLOWED_ORIGINS` | 관리자 변경 작업을 허용할 운영 Origin 목록 |
| `TRUST_PROXY` | Render 등 신뢰 프록시 뒤에서 실제 IP/HTTPS 정보를 사용 |
| `ENFORCE_HTTPS` | 운영 HTTPS 강제 |
| `LOGIN_FAILURE_LIMIT` | 계정+IP 로그인 실패 제한 |
| `LOGIN_WINDOW_MINUTES` | 로그인 실패 집계 시간 |
| `BOOTSTRAP_ADMIN_*` | 빈 운영 DB의 최초 관리자 생성값(생성 후 제거) |
| `VITE_API_URL` | 프론트 API 기본 주소, 기본 `/api` |
| `STORAGE_URL` | 레거시 저장소 URL(신규 사진/평면도는 인증 API로 제공) |

실제 `.env`, SQLite 파일, 업로드 폴더는 `.gitignore`에 포함됩니다.

## 10. DB 초기화와 데이터 이관

스키마와 초기 데이터 생성:

```powershell
npm run db:init
```

기존 데이터는 Excel에서 UTF-8 CSV로 저장한 후 가져올 수 있습니다. JSON 배열도 지원합니다.

```powershell
npm run import:data -- C:\data\cells.csv
```

CSV 권장 헤더: `cell_code,cell_name,node_name,site_code,site_name,address,region,line_code,status,memo,responsible_team`

`cell_code`는 UNIQUE 키이며 동일 코드 재수행 시 중복 INSERT 대신 UPDATE합니다.

## 11. 테스트 방법

자동 API 통합 테스트:

```powershell
npm run lint
npm run test:api
npm run test:security
npm run build
```

`test:api`는 테스트 데이터를 종료 시 정리하면서 다음 흐름을 검증합니다.

1. 회원가입(`pending`)
2. 승인 전 로그인 차단 메시지
3. 관리자 대기 사용자 조회 및 승인
4. 승인 사용자 로그인/HttpOnly 세션
5. CELL 부분검색 및 상세 관계 조회
6. worker 업무이관 등록 권한 차단
7. 일일업무 DB 저장
8. 자재사용 저장과 재고 차감
9. manager 업무이관 등록
10. 업무 상태 완료 변경

`test:security`는 익명/일반 사용자 관리자 API 차단, 잘못된 세션, SQL 바인딩, 업로드 MIME·시그니처, 비공개 사진 접근, Origin/CSRF, 로그인 잠금, 보안 헤더, 감사로그를 검증합니다.

수동 테스트는 회원가입 → 관리자(`user-5`) 로그인 → 헤더 방패 버튼 → 가입 승인 → 신규 계정 로그인 → CELL 검색 → 상세 조회 → 일일업무/업무이관/자재사용 저장 → 재조회 순으로 진행합니다.

## 12. 국사별 B2C·직선도 XLSX 업데이트 규칙

- 관리자 화면에서 국사명과 `.xlsx` 파일을 등록합니다. 같은 국사의 파일을 다시 등록하면 기존 B2C 행을 새 선번장 내용으로 교체합니다. 파일명이 바뀌어도 국사 정규화 키를 기준으로 교체됩니다.
- 시트명에 `선번장`이 포함되고 D/H/M/P 헤더가 확인되는 시트만 B2C DB로 읽습니다. D열은 노드명, H열은 코어, L열은 서비스 회선번호, M열은 서비스 회선명, N열은 서비스구분, O열은 서비스타입, P열은 비고입니다.
- B2C 검색 대상은 L~P열뿐입니다. 검색어와 저장값에서 공백을 제거하며, 공백 제외 5글자 이상을 입력하면 연속 5글자 일치 결과를 반환합니다. 전체 문자열 일치는 결과 상단에 정렬됩니다.
- CELL 직선도는 조회된 국사의 OTX/ORX 노드 시트에서 CELL명 기준 공백 제외 연속 6글자를 검색합니다. B2C 직선도는 선번장 D열 노드 시트에서 L~P 검색값 기준 연속 5글자를 검색하고 첫 좌표를 즉시 표시합니다.
- 선번장을 제외한 모든 시트는 각각 독립된 직선도로 등록됩니다. `국사 + 시트명`을 동일 지도 키로 사용하므로 다음 업로드에서 시트별 버전이 이어집니다.
- 새 직선도 렌더링이 완료되기 전에는 기존 ACTIVE 버전을 계속 제공합니다. 서식 전용 UsedRange를 무시하고 실제 셀·표시 도형에 18pt 여백을 둔 벡터 PDF를 생성하며, PDF point 좌표와 Manifest를 합쳐 시트당 객체 3개만 업로드합니다.
- 브라우저는 PDF.js로 현재 화면과 교차하는 페이지만 확대 배율·DPR에 맞춰 그립니다. 검색 좌표는 좌상단 원점 PDF point와 페이지 좌표를 함께 저장하고 PDF 내부 기준점으로 Excel→PDF scale/offset을 보정합니다.

관련 검증 명령:

```powershell
npm run test:b2c-linebook
npm run test:api
npm run test:straight-map
```

실패한 렌더링을 국사별로 다시 실행하거나 기존 ACTIVE 지도의 좌표를 도형 경계 기준으로 재계산할 수 있습니다.

```powershell
npm run straight-map:retry -- 송탄국사
npm run straight-map:reindex -- 송탄국사
```

## 13. 전송망 일일업무 관리

일일업무는 기존 로그인 세션과 `worker`/`manager`/`admin` 역할을 그대로 사용합니다. 일반 사용자는 Asia/Seoul 서버 날짜 기준 오늘 본인 데이터만 등록·수정할 수 있고, 관리자는 모든 사용자와 날짜를 수정할 수 있습니다. 권한 검사는 화면뿐 아니라 API에서도 수행합니다.

업무구분은 `work_categories`, 일별 기본정보는 `daily_work`, 업무구분별 건수는 `daily_work_items`에 저장합니다. 초기 업무구분은 `WORK01`~`WORK10` 코드로 등록되며 화면과 Excel은 활성 업무구분을 조회해 동적으로 열을 만듭니다. 생성·수정·삭제 이력은 변경 전후 JSON과 함께 `daily_work_history`에 기록합니다.

주요 API:

| 구분 | API |
|---|---|
| 등록/내역/상세/수정 | `POST /api/daily-work`, `GET /api/daily-work/my`, `GET/PUT /api/daily-work/:id` |
| 개인별/지역별/월별/기간별 | `GET /api/admin/daily-work/person`, `/region`, `/month`, `/period` |
| 상세 드릴다운 | `GET /api/admin/daily-work/drilldown`, `/detail/:id` |
| Excel | `GET /api/daily-work/export`, `GET /api/admin/daily-work/export` |
| 변경이력 | `GET /api/daily-work/:id/history`, `GET /api/admin/daily-work/history` |

PC에서는 날짜와 합계가 고정된 가로 스크롤 표를, 모바일에서는 업무구분별 카드와 하단 고정 전체 합계를 사용합니다. Excel은 현재 검색조건과 정렬을 그대로 적용해 DB 집계값으로 생성합니다.
