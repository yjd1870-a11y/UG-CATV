# 사진 저장·보존 운영 절차

## 보호 범위

업무이관 사진 저장·삭제 로직과 API/UI는 이 정책의 대상이 아니다. CELL 작업이력 사진과 능동자재 사용 사진만 대상으로 한다.

## CELL 작업이력 레거시 마이그레이션

1. Render 영구 디스크의 SQLite 파일과 Cloudflare R2 버킷을 각각 백업한다.
2. `npm run photos:migrate-cell-history -- --batch-size=50`으로 dry-run 결과를 확인한다.
3. 백업 완료 후 `npm run photos:migrate-cell-history -- --apply --backup-confirmed --batch-size=50`을 반복한다.
4. `remainingHistories`가 0이고 `issues`가 없는지 확인한다.
5. 앱에서 임의 이력의 썸네일/원본 열람과 삭제를 검증한다.
6. SQLite 파일 크기는 레코드 삭제만으로 즉시 줄지 않는다. 충분한 여유 공간과 서비스 중단 시간을 확보한 뒤 별도 유지보수 창에서 `VACUUM`을 수행한다.

삭제된 작업이력의 Base64는 R2로 올리지 않고 `photos_json`만 비운다. 활성 이력은 각 사진이 R2와 자산 테이블에 모두 등록된 뒤에만 Base64를 비운다. 도구는 중간 실패 후 다시 실행할 수 있다.

## 능동자재 사진

- 진행중 월 Excel 다운로드는 사진을 `EXPORTED`로 표시하지만 삭제 예정일을 만들지 않는다.
- 월마감은 해당 월의 누락 사진과 미내보내기 사진이 있으면 거부된다.
- 마감 성공 시점부터 30일 뒤를 `delete_after`로 고정한다. 재다운로드는 이 날짜를 연장하지 않는다.
- 마감 취소 시 아직 삭제되지 않은 사진의 `delete_after`를 제거한다.
- 만료 정리는 서버 시작 시, 24시간마다, Excel 생성 후, 관리자 수동 API에서 실행된다.
- 거래 삭제는 R2 원본·썸네일이 모두 삭제된 뒤에만 거래를 역처리한다. 실패하면 거래는 유지되고 사진 자산에 재시도 상태가 남는다.

고아 후보 확인은 `npm run photos:audit-material-orphans`로 수행한다. 실제 정리는 백업 후 `npm run photos:audit-material-orphans -- --apply --backup-confirmed`를 사용한다.

## 저장량 경보

`GET /api/material-management/photos/storage-summary`는 DB에 기록된 CELL 작업이력/능동자재 사진 크기를 합산한다. 7GB부터 `WARNING`, 8.5GB부터 `CRITICAL`이다. 이는 관리 대상 객체의 논리 합계이며 R2 버킷 전체 사용량과 차이가 날 수 있으므로 Cloudflare 대시보드의 실제 저장량도 함께 확인한다.

CELL 작업이력 사진 15,000장을 사진당 원본 250KB + 썸네일 30KB의 최댓값으로 계산하면 약 4.0GiB다. 실제 압축 결과는 이보다 작지만 다른 R2 객체와 실패 업로드 격리 객체를 포함해 7GB부터 점검하도록 한다. 능동자재 사진은 월마감 후 30일 보존정책으로 상시 누적을 막는다.
