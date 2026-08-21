# 직선도 v2 운영·배포·롤백 절차

## 적용 아키텍처

```text
관리자 브라우저
  -> Render: 업로드 Job + 짧은 Presigned PUT 발급
  -> R2 sources/{sha256}.xlsx 직접 PUT
  -> Render: R2 HEAD 확인 후 WAITING_FOR_OFFICE_RENDERER

Windows 사용자 세션의 온디맨드 Agent
  -> Render: CLAIM / lease / 30초 heartbeat
  -> R2: Presigned GET으로 XLSX 스트리밍 다운로드 + SHA-256 재검증
  -> Excel COM: 매크로·이벤트·링크 갱신 차단, 시트별 PDF export
  -> PDF 페이지 단위 Deep Zoom 타일 생성(전체 워크시트 PNG 없음)
  -> R2 artifacts/{artifactSetId}/ 직접 PUT, manifest.json은 마지막
  -> Render: HEAD·객체 수·level 범위·좌표/manifest hash 검증
  -> SQLite 한 트랜잭션: 이전 ACTIVE ARCHIVED + 신규 ACTIVE + Job COMPLETED

사용자 조회
  -> Render: ACTIVE 권한 확인
  -> R2 Presigned GET으로 302 redirect(Render binary proxy 없음)
```

사무실 PC나 Agent가 꺼져 있어도 기존 `map_versions.status='ACTIVE'` 행과 R2 타일에는 변화가 없다. 업로드/렌더링/검증 실패 시 ACTIVE 전환 트랜잭션을 실행하지 않는다.

## 스키마 마이그레이션

애플리케이션 시작 시 기존 테이블을 삭제하거나 재작성하지 않고 다음을 추가한다.

- `straight_maps`: 국사/시트별 ACTIVE artifact 포인터
- `straight_map_jobs`: 영속 Job, 상태, lease, heartbeat, attempt
- `straight_map_job_sheets`: 시트 checkpoint와 cache hit
- `straight_map_artifact_sets`: immutable prefix, profile/cache/hash, VERIFIED 상태
- `map_versions`: `artifact_set_id`, source/manifest key, renderer engine/profile, cache/coordinate hash, DPI, archived timestamp

기존 ACTIVE 버전은 그대로 남는다. v2 결과만 신규 컬럼을 채운다.

## 신규 API

관리자 세션 API:

- `POST /api/admin/straight-maps/upload-url`
- `POST /api/admin/straight-maps/uploads/:jobId/complete`
- `GET /api/admin/straight-maps/jobs`
- `POST /api/admin/straight-maps/jobs/:jobId/retry`
- `POST /api/admin/straight-maps/jobs/:jobId/cancel`
- `POST /api/admin/straight-maps/versions/:versionId/rollback`

device token API:

- `POST /api/renderer/session`
- `POST /api/renderer/jobs/claim`
- `POST /api/renderer/jobs/:jobId/source-url`
- `POST /api/renderer/jobs/:jobId/heartbeat`
- `POST /api/renderer/jobs/:jobId/progress`
- `POST /api/renderer/jobs/:jobId/sheets`
- `POST /api/renderer/jobs/:jobId/artifacts/upload-urls`
- `POST /api/renderer/jobs/:jobId/complete`
- `POST /api/renderer/jobs/:jobId/fail`

타일 API는 로그인/권한 확인 후 R2로 `302`를 반환한다.

## 배포 전 백업

1. Render Shell에서 v2 플래그가 꺼진 것을 확인한다.
2. SQLite 일관 백업을 만든다.

   ```powershell
   npm run straight-map:backup
   npm run straight-map:snapshot
   ```

3. 출력된 SQLite 파일과 좌표 snapshot JSON을 Render 영구 디스크 밖의 승인된 백업 위치에 복사한다.
4. R2 inventory 또는 객체 목록으로 현재 `line-diagrams/` key 수와 용량을 기록한다.
5. 현재 ACTIVE 목록과 좌표 snapshot SHA-256을 변경 기록에 남긴다.

SQLite WAL 파일을 단순 복사하지 않고 `wal_checkpoint(FULL)` 뒤 `VACUUM INTO`로 백업한다.

## 단계적 배포

1. 코드와 additive DB migration을 배포한다. `STRAIGHT_MAP_PIPELINE_V2_ENABLED=false`를 유지한다.
2. 로그인, 기존 ACTIVE 직선도, B2C, 평면도, 모바일 조회를 회귀 확인한다.
3. R2 CORS에 운영 Pages/도메인과 `Content-Type`, `Cache-Control`, `x-amz-meta-sha256` PUT header를 허용한다.
4. Render에 32바이트 이상 `STRAIGHT_MAP_RENDERER_DEVICE_TOKEN`을 secret으로 설정한다.
5. Windows PC에 Node.js 22, Excel, Poppler(`pdfinfo.exe`, `pdftoppm.exe`)를 준비한다. R2 Access Key는 두지 않는다.
6. Render에서 `STRAIGHT_MAP_PIPELINE_V2_ENABLED=true`로 바꾼다.
7. 최대·중간·소형 직선도 3개만 업로드하고 Agent를 `renderer-agent\start-renderer.cmd -Once`로 실행한다.
8. 각 파일의 PDF/Excel 시각 비교, 100%·400%·최대 확대, 검색 마커의 1px 이내 오차, 타일 수, R2 용량, 처리 시간과 PC/Render 최대 RSS를 기록한다.
9. 3개가 승인된 뒤에만 나머지 파일을 순차 처리한다. 자동 전체 재렌더링 기능은 없다.

## 운영자 사용 순서

1. 관리자 화면에서 국사명과 `.xlsx`를 선택한다.
2. 브라우저 SHA-256과 R2 직접 업로드가 끝나면 `사무실 렌더러 실행 대기 중`을 확인한다.
3. Windows 사용자로 로그인하고 `renderer-agent\start-renderer.cmd`를 실행한다.
4. 진행 시트, heartbeat, attempt, 실제 경과시간과 오류를 관리자 화면에서 확인한다.
5. 완료 후 조회 화면의 확대 품질과 `#G210030`, `#G21004A` 같은 실제 표식을 검사한다.
6. 실패 Job은 원인을 해결한 뒤 `재시도`한다. DPI fallback은 자동 적용하지 않는다.

## 롤백

결과 한 버전만 되돌릴 때는 관리자 rollback API를 사용한다. 한 SQLite 트랜잭션에서 현재 ACTIVE를 ARCHIVED로, 선택한 ARCHIVED를 ACTIVE로 바꾸고 `straight_maps.active_artifact_set_id`를 갱신한다. R2 복사/rename/delete는 하지 않는다.

배포 전체를 되돌릴 때:

1. `STRAIGHT_MAP_PIPELINE_V2_ENABLED=false`로 바꿔 신규 업로드/claim을 차단한다.
2. 진행 중 Job은 관리자 화면에서 취소한다.
3. 기존 ACTIVE 조회가 정상인지 확인한다. 코드 롤백만으로 기존 v2 테이블/컬럼을 삭제하지 않는다.
4. DB 자체 복원이 필요한 경우 서비스를 중지하고 백업 SQLite를 복원한 뒤 무결성 검사와 ACTIVE 조회를 확인한다.
5. `artifacts/`와 `sources/` 객체는 즉시 삭제하지 않는다. DB 참조와 rollback 보존 기간을 확인한 후 별도 정리한다.

## R2 보존 정책

- `sources/{sha256}.xlsx`: content-addressed, 참조가 있는 동안 보존
- `artifacts/{artifactSetId}`: 생성 후 변경 금지, ACTIVE/ARCHIVED 참조 중 삭제 금지
- 실패한 PREPARING/FAILED artifact: 최소 7일 보존 후 DB 참조가 없을 때만 정리
- `optional-logs/`: 운영 정책에 따라 30~90일

prefix 전체에 무조건적인 짧은 Lifecycle을 적용하면 rollback artifact가 삭제될 수 있으므로 금지한다.

## 아직 현장 검증이 필요한 항목

저장소의 자동 테스트는 DB migration, lease 재CLAIM, heartbeat, retry/cancel, cache 판정, rollback, 기존 좌표 추출, 빌드와 API 회귀를 검증한다. 실제 Excel/R2/운영 XLSX가 필요한 다음 값은 사무실 PC 파일럿 전에는 확정할 수 없다.

- 송탄국사 실제 시트 목록과 표식 표시 결과
- 1100 DPI·512px 렌더링 시간 및 최대 Excel/Poppler/Node 메모리
- Render 운영 RSS, R2 객체 수·용량
- Excel/PDF/타일과 마커의 실측 1px 오차
- 모바일 pan/zoom 및 3개 운영 직선도의 시각 승인

이 항목이 기록·승인되기 전에는 기존 ACTIVE를 일괄 교체하지 않는다.
