# CATV 업무관리 운영 배포 안내

## 확정 배포 구조

```text
Cloudflare Pages (React/Vite)
  -> HTTPS + credentialed CORS
Render Web Service (Express API)
  -> Render persistent disk의 SQLite
  -> Private Cloudflare R2 (사진, 평면도, 직선도 산출물)
```

프런트엔드는 DB나 R2 자격 증명을 가지지 않습니다. 현장 사진은 API에서 발급한 5분짜리 presigned PUT URL로 브라우저가 R2에 직접 올리고, 업로드 완료 후 API가 R2의 실제 MIME/크기를 확인한 뒤 DB 메타데이터를 기록합니다. 조회는 권한 확인 후 짧은 presigned GET URL로 리다이렉트합니다.

## 중요한 데이터베이스 결정

현재 전체 API는 동기식 `node:sqlite` SQL에 결합되어 있습니다. 이를 PostgreSQL로 바꾸려면 모든 저장소·트랜잭션·쿼리를 비동기 방식으로 이관해야 하므로 설정 변경이 아니라 별도 데이터 마이그레이션 작업입니다. 기존 기능을 보존하기 위해 이번 배포 구성은 Render의 **유료 persistent disk**에 SQLite를 둡니다.

- `render.yaml`은 `starter` 인스턴스와 `/var/data` 디스크를 사용합니다.
- Render 무료 인스턴스의 일회성 파일시스템으로 운영하면 안 됩니다.
- PostgreSQL 전환 전에는 인스턴스를 1개만 실행해야 합니다. SQLite 파일을 여러 인스턴스가 공유할 수 없습니다.
- PostgreSQL/D1을 필수 조건으로 삼는다면 현재 배포는 보류하고 DB 어댑터 이관을 먼저 완료해야 합니다.

## 직선도 처리 제약

직선도 XLSX 렌더러는 Windows Excel COM과 PowerShell을 사용합니다. Linux 기반 Render에서는 신규 직선도 렌더링이 불가능합니다.

운영 절차는 다음과 같습니다.

1. Excel이 설치된 Windows 처리 PC에서 관리자 XLSX 업로드·렌더링을 실행합니다.
2. 처리 PC에도 운영 R2 환경변수를 설정합니다.
3. 완료된 원본, PNG, Deep Zoom WebP 타일은 `line-diagrams/{mapId}/{version}/`에 게시됩니다.
4. Render는 DB 검색과 권한 검사 후 R2 타일의 signed URL만 발급합니다.

장기적으로 Render만으로 처리하려면 LibreOffice 기반 렌더러 또는 별도의 Windows 작업 노드를 구축해야 합니다.

## 1. Cloudflare R2

1. Private bucket `catv-storage`를 만듭니다.
2. 이 버킷에만 Object Read & Write 권한을 가진 R2 API token을 발급합니다.
3. `r2-cors.example.json`의 두 origin을 실제 Pages/custom domain으로 바꿔 R2 CORS에 적용합니다.
4. `r2.dev` public access는 켜지 않습니다.

사용 prefix:

- `photos/YYYY/MM/{userId}/{uuid}.webp`
- `floorplans/{planId}/{uuid}.png`
- `line-diagrams/{mapId}/{version}/...`

## 2. Render

저장소 루트의 `render.yaml`로 Blueprint를 생성합니다. Dashboard에서 `sync: false` 항목을 입력합니다.

필수 값:

```env
SESSION_SECRET=<32바이트 이상의 무작위 값>
CORS_ALLOWED_ORIGINS=https://YOUR_PROJECT.pages.dev,https://catv.example.com
ADMIN_MUTATION_ALLOWED_ORIGINS=https://catv.example.com
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=catv-storage
```

최초 빈 DB에만 `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`을 설정합니다. 관리자 생성 후 세 값을 삭제하고 비밀번호를 변경합니다.

검증 URL:

```text
https://YOUR_SERVICE.onrender.com/api/health
```

정상 응답의 `data.status`, `data.database`, `data.storage`는 각각 `ok`, `ok`, `r2`입니다.

## 3. Cloudflare Pages

GitHub 저장소를 Pages에 연결하고 다음 값을 사용합니다.

```text
Production branch: main
Build command: npm run build
Build output directory: dist
```

Pages 환경변수:

```env
VITE_API_BASE_URL=https://YOUR_SERVICE.onrender.com/api
```

`public/_redirects`가 SPA 새로고침을 `index.html`로 연결하고, `public/_headers`가 정적 자산 캐시와 브라우저 보안 헤더를 설정합니다.

## 4. 배포 전 검증

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run test:api
npm.cmd run test:security
npm.cmd run test:b2c-linebook
npm.cmd run test:straight-map
npm.cmd run build
```

실제 자격 증명이 있는 환경에서는 추가로 확인합니다.

1. 일반/관리자 로그인과 로그아웃
2. 허용하지 않은 origin의 CORS 차단
3. 모바일 사진 presigned PUT 및 완료 등록
4. 사진 GET signed URL과 권한 없는 접근 차단
5. 평면도 조회
6. Windows 처리 PC의 직선도 게시 및 Render 타일 조회
7. DB 업로드 validation, bulk 반영, audit log
8. 모바일/PC 화면과 네트워크 재시도

## 5. 복구와 백업

- 배포 전에 `/var/data/catv.sqlite`와 WAL 파일을 일관된 상태로 백업합니다.
- R2 lifecycle은 `temp/`에만 적용하고 운영 객체 prefix에는 자동 삭제를 적용하지 않습니다.
- DB에는 object key와 메타데이터만 저장합니다.
- 파일 삭제는 R2 삭제 성공 후 DB를 soft delete합니다.
- PostgreSQL 전환 시에는 SQLite 스냅샷, 행 수, FK, 검색 인덱스, object key 참조를 대조합니다.
