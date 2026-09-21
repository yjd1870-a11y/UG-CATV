# 자재관리·사진 압축 한정 배포 절차

## 고정 범위

- 변경 허용: 사진 디코딩·회전·EXIF 제거·압축 모듈, 자재관리 API/UI/Excel/R2 저장 모듈
- 변경 금지: CELL 조회, 업무이관, 일일업무의 라우트·서비스·UI 및 `backend/db.ts`
- 자재 API는 `backend/modules/material-management.ts`에서만 등록한다.
- 자재 모듈은 CELL·업무이관·일일업무 테이블을 조회할 수 있지만 쓰면 안 된다.

## 배포 차단 장치

`npm run build` 전에 `test:deployment-scope`가 자동 실행된다. 보호 파일의 내용이 운영 기준선과 다르거나 자재 모듈에서 보호 테이블 쓰기가 감지되면 빌드와 배포가 실패한다.

보호 기준선을 변경하는 행위는 CELL·업무이관·일일업무 변경에 대한 별도 승인으로 취급한다.

## 배포 전 검증

```text
npm run test:material-release
npm run test:protected-regression
npm run build
```

운영 DB 백업이 확인되지 않으면 배포하지 않는다. 신규 DB 변경은 이번 범위에 포함하지 않는다.

## 배포 순서

1. `MATERIAL_MANAGEMENT_ENABLED=false`, `VITE_MATERIAL_MANAGEMENT_ENABLED=false`를 확인한다.
2. Render에 배포하고 `/api/health`와 시작 로그를 확인한다.
3. 동일 커밋을 Cloudflare Pages에 배포하고 SPA 새로고침과 API 프록시를 확인한다.
4. 기능 플래그가 꺼진 상태에서 기존 화면과 API가 정상인지 확인한다.
5. 별도 승인된 테스트 시간에만 자재관리 플래그를 켜고 사진 압축·자재 사용 시나리오만 수행한다.

## 운영 후 테스트 범위

- JPG/PNG/WebP 실제 디코딩, 회전 보정, EXIF/GPS 제거, 크기 제한, JPEG master/thumbnail 생성
- 자재 사진 SHA-256, 해상도, 용량, R2 object key 확인
- 현장자재 입고·사용·회수·불량, 국사 예비품 이동·수리·폐기, 권한·중복요청·음수재고 차단
- 자재 Excel 내보내기와 감사로그의 동일 트랜잭션 저장

CELL 조회, 업무이관 완료, 일일업무 등록·수정은 운영 후 테스트에서 변경 요청을 보내지 않는다.

## 중단 기준

- 보호 범위 검사 실패
- DB 백업 실패
- Render health 실패 또는 오류 증가
- 사진 변환 실패·R2 업로드 불일치
- 재고 음수, 중복 거래, 감사로그 누락

중단 시 자재관리 플래그를 즉시 끄고 직전 배포로 롤백한다. 기존 운영 테이블이나 사진 객체를 수동 삭제하지 않는다.
