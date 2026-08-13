# CATV 업무관리 기능 모듈 안내서

이 문서는 개발 경험이 없어도 “어떤 기능을 어느 폴더에서 찾아야 하는지” 빠르게 확인할 수 있도록 만든 지도입니다. 이번 정리는 기존 화면과 API 주소를 유지하면서 파일의 책임만 기능별로 나눴습니다.

## 기능별 위치

| 업무 기능 | 화면(UI) | 브라우저 API | 서버 API |
|---|---|---|---|
| 로그인·회원가입 | `src/components/auth` | `src/features/auth/api.ts` | `backend/routes/auth.ts` |
| 홈·공지 | `src/components/home` | `src/features/home`, `src/features/notices` | `backend/routes/notices.ts` |
| CATV CELL·B2C·평면도·직선도 | `src/components/cell` | `src/features/cells` | `backend/routes/cells.ts`, `b2c.ts`, `floor-plans.ts`, `straight-maps.ts` |
| 업무 이관 | `src/components/transfer` | `src/features/transfers` | `backend/routes/work-transfers.ts` |
| 일일 업무 | `src/components/daily` | `src/features/daily-work` | `backend/routes/daily-work.ts`, `admin-daily-work.ts` |
| 자재·사용 내역 | `src/components/material` | `src/features/materials` | `backend/routes/materials.ts` |
| 관리자·DB 업로드 | `src/components/admin` | `src/features/admin` | `backend/routes/admin.ts` |

## 전체 구조

```text
CATV 업무관리/
├─ src/
│  ├─ app/ActiveView.tsx       # 메뉴에 따라 기능 화면을 여는 곳
│  ├─ components/              # 사용자가 실제로 보는 화면
│  ├─ features/                # 기능별 API와 화면 진입점
│  │  ├─ auth/
│  │  ├─ cells/
│  │  ├─ transfers/
│  │  ├─ daily-work/
│  │  ├─ materials/
│  │  ├─ notices/
│  │  ├─ home/
│  │  └─ admin/
│  ├─ shared/api/client.ts     # 모든 기능이 함께 쓰는 통신 처리
│  └─ services/api.ts          # 이전 코드 호환용(새 코드는 features 사용)
└─ backend/
   ├─ modules/                 # 서버 기능 묶음과 URL 등록부
   │  ├─ auth.ts               # 인증
   │  ├─ network.ts            # CELL/B2C/평면도/직선도
   │  ├─ operations.ts         # 공지/이관/일일업무/자재
   │  ├─ administration.ts     # 관리자
   │  └─ registry.ts           # 위 기능을 서버에 한 번에 연결
   ├─ routes/                  # 실제 API 업무 규칙
   └─ security/                # 로그인 세션과 보안 정책
```

## 파일을 고칠 때의 간단한 기준

- 버튼, 표, 입력창 등 보이는 모양을 바꾸려면 `src/components/<기능>`을 수정합니다.
- 화면에서 서버로 보내거나 받아오는 항목을 바꾸려면 `src/features/<기능>/api.ts`를 수정합니다.
- 저장, 조회, 권한 검사 같은 서버 업무 규칙은 `backend/routes/<기능>.ts`를 수정합니다.
- 로그인 쿠키, CSRF, 접근 제한은 `backend/security`를 수정합니다.
- 공통 통신 오류 처리만 `src/shared/api/client.ts`에서 수정합니다.

## 새 기능을 추가하는 순서

1. `src/features/새기능/api.ts`에 브라우저 API를 만듭니다.
2. `src/components/새기능`에 화면을 만듭니다.
3. `backend/routes/새기능.ts`에 서버 API를 만듭니다.
4. 알맞은 `backend/modules/*.ts`에 URL을 등록합니다.
5. 새 메뉴 화면이면 `src/app/ActiveView.tsx`에 연결합니다.
6. `npm run lint`, `npm run build`, 관련 API 테스트를 실행합니다.

`src/services/api.ts`는 기존 파일이 갑자기 깨지지 않도록 남겨 둔 호환 통로입니다. 앞으로 작성하는 코드는 이 파일 대신 해당 `src/features` 모듈을 직접 사용하면 됩니다.
