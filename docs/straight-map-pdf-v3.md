# 직선도 PDF viewport v3

직선도는 고정 DPI WebP 타일을 만들지 않는다. 브라우저가 XLSX 원본을 R2에 직접 올리고, Windows Excel Agent는 시트별 벡터 `map.pdf`, PDF point 좌표 `coordinates.json`, 원자적 전환용 `manifest.json`만 업로드한다. Manifest는 항상 마지막에 업로드하며 서버 검증 후에만 ACTIVE로 전환한다.

## 좌표와 해상도

- 기준 좌표계는 PDF point(1/72 inch), 좌상단 원점이다.
- 각 검색 객체는 `pageIndex/pageXPoints/pageYPoints`와 문서 전체 `worldXPoints/worldYPoints`, 호환용 `xRatio/yRatio`를 함께 저장한다.
- Excel이 적용하는 프린터 하드 여백은 PDF에 포함된 두 개의 보이지 않는 벡터 기준점을 PDF.js로 읽어 scale/offset을 보정한다. 기준점을 읽을 수 없는 예외만 페이지 맞춤 비율로 fallback한다.
- 화면 좌표는 `screen = pan + worldPoints * zoom` 한 식으로 계산한다. DPR은 캔버스 래스터화에만 적용하므로 DB 좌표를 반올림하거나 확대 배율에 누적 적용하지 않는다.
- PDF.js는 현재 화면과 교차하는 페이지만 현재 zoom × DPR로 다시 그린다. Excel 텍스트/선은 벡터로 유지되어 1100 DPI에 해당하는 확대에서도 타일 원본보다 먼저 흐려지지 않는다.

## 실제 콘텐츠 경계

Excel의 서식 전용 UsedRange는 무시한다. 값/수식이 있는 첫·마지막 셀과 표시 중인 모든 도형의 경계를 합치고 18pt 여백을 둔다. 화면의 홈/전체화면 맞춤도 PDF 용지 전체가 아니라 이 `contentBounds`만 사용하므로 빈 흰 공간을 표시하거나 렌더링하지 않는다.

## 성능·비용 예상

기존 60분 작업에서 PDF 래스터화, WebP 인코딩, 수천~수만 PUT과 전수 타일 검증을 제거한다. Excel PDF 생성 시간이 통상 수분인 전제에서 설계 목표는 시트 묶음당 3~10분(약 83~95% 단축)이다. 실제 수치는 `npm run straight-map:benchmark-pdf -- renderer-metrics.json`으로 측정한다.

추가 비용은 보통 감소한다. R2 저장량과 Class A PUT이 크게 줄고 PDF GET/egress 및 브라우저 CPU가 늘 수 있다. 동일 PDF는 immutable cache를 사용하고 PDF.js range 요청을 허용해 이를 제한한다.

## 전환과 삭제

v3 prefix는 `line-diagrams/v3/sources/`와 `line-diagrams/v3/documents/`이다. 기존 v2 데이터는 개발·검증 완료 전 자동 삭제하지 않는다. `npm run straight-map:cleanup-v2`는 항상 dry-run이며, 실제 삭제는 출력된 확인 문자열과 `--execute`를 함께 제공해야 한다. 스크립트는 직선도 v2 테이블 행 및 `line-diagrams/sources/`, `line-diagrams/artifacts/`만 대상으로 하며 다른 업무 데이터나 v3 prefix를 삭제하지 않는다.
