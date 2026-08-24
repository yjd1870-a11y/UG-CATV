# CATV 직선도 Windows 렌더러 Agent

이 프로그램은 상시 서버나 Windows Service가 아닙니다. Microsoft Excel이 설치된 Windows 사용자 세션에서 운영자가 필요할 때만 실행합니다.

필수 도구는 Node.js 22와 Microsoft Excel입니다. R2 Access Key는 PC에 저장하지 않으며, Render API의 짧은 Presigned URL만 사용합니다.

1. Render와 Agent에 동일한 32바이트 이상 device token을 준비합니다.
2. Render에는 `STRAIGHT_MAP_RENDERER_DEVICE_TOKEN`으로 설정합니다.
3. PC에서는 Windows Credential Manager 대상 이름 `CATV Straight Map Renderer`에 저장하는 방식을 권장합니다. PowerShell CredentialManager 모듈이 없으면 실행할 때 보안 프롬프트로 입력하며 디스크에는 쓰지 않습니다.
4. `CATV_RENDERER_API_URL`을 Render 서비스의 HTTPS URL로 설정합니다.
5. `renderer-agent\start-renderer.cmd` 또는 `npm run renderer:agent -- --once`를 실행합니다.

로컬 `http://localhost:3000`은 서버가 `backend/data/straight-map-renderer.token`을 자동 생성하고 Agent가 같은 파일을 읽으므로 별도 token 입력이 필요 없습니다.

Agent는 한 번에 한 Job만 처리합니다. 매크로, 이벤트, 외부 링크 갱신을 차단하고, XLSX를 로컬 임시 폴더로 스트리밍 다운로드한 뒤 SHA-256을 검증합니다. 시트별 벡터 PDF와 PDF point 좌표를 만들며 `map.pdf`, `coordinates.json`, `manifest.json`만 R2 immutable prefix에 직접 업로드합니다. Manifest는 항상 마지막에 업로드됩니다.

운영 권장값은 `STRAIGHT_MAP_UPLOAD_CONCURRENCY=6`이며 1~8 범위에서 조정합니다. 업로드 동시성은 산출물 캐시 키를 바꾸지 않습니다.
