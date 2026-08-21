# CATV 업무관리 운영 배포 안내

## 운영 아키텍처

```text
Cloudflare Pages (React/Vite)
  https://ugt-transmission-network.pages.dev
        |
        | HTTPS + credentialed CORS
        v
Render Web Service (Express API)
  https://ratis-transmission-webapp-yjd1870.onrender.com/api
        |-- Render persistent disk + SQLite
        `-- Private Cloudflare R2 bucket: ratis-photos
```

프론트엔드는 정적 파일만 배포하며 비밀값을 포함하지 않습니다. 인증, 권한 검사, DB 접근, R2 서명 URL 발급은 모두 Render API에서 처리합니다.

## Cloudflare Pages

- 프로젝트: `ugt-transmission-network`
- 운영 주소: `https://ugt-transmission-network.pages.dev`
- Git 저장소: `yjd1870-a11y/UG-CATV`
- 운영 브랜치: `main`
- 빌드 명령: `npm run build`
- 출력 디렉터리: `dist`
- 빌드 환경 변수(`wrangler.jsonc`이 구성의 기준 파일):

```env
VITE_API_BASE_URL=https://ratis-transmission-webapp-yjd1870.onrender.com/api
```

Cloudflare의 Git 연동이 `main` 커밋을 자동 빌드·배포합니다. GitHub Actions는 별도로 배포하지 않고 린트와 Pages 산출물만 검증합니다.

최상위 `404.html`을 만들지 않아 Cloudflare Pages의 기본 SPA 폴백을 사용합니다. `public/_headers`는 보안 헤더와 정적 자산 캐시 정책을 적용합니다.

## Render API

- 서비스 ID: `srv-d9fhuq3h523c73f9orj0`
- 서비스 표시명: `ugt-transmission-network`
- API 주소: `https://ratis-transmission-webapp-yjd1870.onrender.com/api`
- 상태 확인: `https://ratis-transmission-webapp-yjd1870.onrender.com/api/health`
- 영구 디스크: `/var/data`
- SQLite: `/var/data/catv.sqlite`

운영 출처는 와일드카드 없이 정확히 지정합니다.

```env
CORS_ALLOWED_ORIGINS=https://ratis-transmission-webapp-yjd1870.onrender.com,https://ugt-transmission-network.pages.dev,https://ugt-transmission-network.com,https://www.ugt-transmission-network.com
ADMIN_MUTATION_ALLOWED_ORIGINS=https://ratis-transmission-webapp-yjd1870.onrender.com,https://ugt-transmission-network.pages.dev,https://ugt-transmission-network.com,https://www.ugt-transmission-network.com
```

세션 쿠키는 HTTPS 교차 출처 요청에서 동작하도록 `Secure`와 `SameSite=None`을 유지해야 합니다. 프론트엔드 요청은 `credentials: 'include'`를 사용합니다.

## Cloudflare R2

- 비공개 버킷: `ratis-photos`
- 공개 `r2.dev` 접근: 사용하지 않음
- 브라우저에 R2 API 키를 노출하지 않음
- 브라우저 업로드: Render가 발급한 짧은 만료시간의 presigned PUT URL 사용
- 조회: 권한 검사 후 Render가 presigned GET URL 발급

R2 CORS에는 실제 프론트엔드 주소만 허용합니다. 적용 예시는 `r2-cors.example.json`에 있습니다.

```text
https://ugt-transmission-network.pages.dev
https://ugt-transmission-network.com
https://www.ugt-transmission-network.com
```

주요 객체 경로:

- `photos/YYYY/MM/{userId}/{uuid}.webp`
- `floorplans/{planId}/{uuid}.png`
- `line-diagrams/sources/{sourceSha256}.xlsx`
- `line-diagrams/artifacts/{artifactSetId}/...`

## 직선도 처리 제약

직선도 XLSX 렌더러는 Windows Excel COM과 PowerShell을 사용합니다. Linux 기반 Render에서는 신규 XLSX 렌더링을 수행하지 않습니다. Windows 처리 PC가 PDF 마스터와 페이지 기반 Deep Zoom 타일을 R2 immutable prefix에 직접 게시하며 전체 워크시트 PNG는 만들지 않습니다. Render는 DB 상태·lease·검증·ACTIVE 포인터와 R2 서명 URL만 관리합니다.

로컬 개발에서는 v2 경로가 기본 활성화되며 XLSX를 로컬 디스크로 스트리밍 저장합니다. 운영은 R2를 사용하고 `STRAIGHT_MAP_PIPELINE_V2_ENABLED=true`로 배포합니다. 배포 전에 DB/R2 백업과 파일럿 검증을 완료하고, Windows 렌더러가 작업을 가져가려면 `STRAIGHT_MAP_RENDERER_DEVICE_TOKEN`을 32바이트 이상의 별도 비밀값으로 설정합니다. 토큰이 비어 있으면 업로드 작업은 안전하게 대기하고 렌더러 API만 `RENDERER_NOT_CONFIGURED`로 차단됩니다.

직선도 운영 기본값은 `STRAIGHT_MAP_TARGET_DPI=1100`, `STRAIGHT_MAP_TILE_SIZE=512`, `STRAIGHT_MAP_WEBP_QUALITY=94`, `STRAIGHT_MAP_WEBP_EFFORT=2`, `STRAIGHT_MAP_TILE_CONCURRENCY=2`, `STRAIGHT_MAP_UPLOAD_CONCURRENCY=6`입니다. Render 재배포 후 Windows Renderer Agent도 재시작해야 같은 프로필을 받습니다. 기존 1200 DPI·256px ACTIVE 버전은 Manifest 기반으로 계속 제공되며, 신규 버전의 검증과 원자적 ACTIVE 전환이 끝나기 전에는 교체되지 않습니다.

## 배포 전 검증

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run test:api
npm.cmd run test:security
npm.cmd run test:b2c-linebook
npm.cmd run test:straight-map
$env:VITE_API_BASE_URL='https://ratis-transmission-webapp-yjd1870.onrender.com/api'
npm.cmd run build
```

운영에서는 다음 흐름을 확인합니다.

1. 일반 사용자와 관리자 로그인·로그아웃
2. 허용되지 않은 Origin의 CORS 차단
3. CELL/B2C 선번장 조회와 DB 업로드
4. 평면도·직선도 조회 및 업로드
5. presigned PUT 업로드와 완료 등록
6. 권한 없는 파일 조회 차단
7. 감사 로그 기록
8. PC와 모바일 화면, 느린 네트워크 재시도

## 백업과 복구

- 배포 전 SQLite 본체와 WAL 파일을 일관된 상태로 백업합니다.
- R2 lifecycle 자동 삭제는 임시 경로에만 적용합니다.
- DB에는 R2 object key와 메타데이터만 저장합니다.
- 파일 삭제는 R2 삭제 성공 후 DB에서 soft delete 처리합니다.
