# 프론트엔드 컴포넌트 구조 가이드

## 개요
프론트엔드 컴포넌트들을 기능별로 구조화하여 유지보수성과 개발 효율성을 향상시켰습니다.

## 폴더 구조

```
frontend/src/components/
├── auth/                    # 인증 관련 컴포넌트
│   ├── LoginForm.js
│   ├── RegisterForm.js
│   ├── ProtectedRoute.js
│   └── index.js
├── dashboard/               # 대시보드 관련 컴포넌트
│   ├── UserDashboard.js
│   └── index.js
├── inspection/              # 검사 관련 컴포넌트
│   ├── ResourceInspectionTab.js
│   ├── ServiceInspectionSelector.js
│   ├── InspectionResultsView.js
│   ├── BackgroundInspectionManager.js
│   ├── BackgroundInspectionMonitor.js
│   ├── InspectionStatusBar.js
│   ├── InspectionToast.js
│   ├── InspectionWithBackground.js
│   ├── InspectionStateRestorer.js
│   ├── SmartInspectionUI.js
│   ├── WebSocketStatus.js
│   ├── progress/            # 진행률 관련 컴포넌트
│   │   ├── EnhancedProgressMonitor.js
│   │   ├── ProgressIndicator.js
│   │   ├── GlobalProgressIndicator.js
│   │   ├── BottomProgressIndicator.js
│   │   ├── MinimalProgressIndicator.js
│   │   ├── ServiceWorkerProgressIndicator.js
│   │   └── index.js
│   └── index.js
├── history/                 # 검사 히스토리 관련 컴포넌트
│   ├── InspectionHistory.js
│   ├── InspectionDetailModal.js
│   └── index.js
├── admin/                   # 관리자 관련 컴포넌트
│   ├── UserList.js
│   └── index.js
├── common/                  # 공통 컴포넌트
│   ├── Navigation.js
│   └── index.js
└── index.js                 # 전체 컴포넌트 re-export
```

## 사용법

### 1. 개별 컴포넌트 import
```javascript
import { LoginForm } from '../components/auth';
import { UserDashboard } from '../components/dashboard';
import { ResourceInspectionTab } from '../components/inspection';
import { EnhancedProgressMonitor } from '../components/inspection/progress';
```

### 2. 전체 컴포넌트에서 import (기존 방식 유지)
```javascript
import { LoginForm, UserDashboard, ResourceInspectionTab } from '../components';
```

## 각 폴더별 역할

### auth/
- 사용자 인증 관련 모든 컴포넌트
- 로그인, 회원가입, 라우트 보호 기능

### dashboard/
- 사용자 대시보드 관련 컴포넌트
- 프로필 관리, 비밀번호 변경 등

### inspection/
- AWS 리소스 검사 관련 모든 컴포넌트
- 검사 시작, 진행률 모니터링, 결과 표시
- progress/ 서브폴더: 진행률 표시 관련 컴포넌트들

### history/
- 검사 히스토리 관련 컴포넌트
- 과거 검사 결과 조회, 상세 정보 모달

### admin/
- 관리자 기능 관련 컴포넌트
- 사용자 관리, 승인/거부 등

### common/
- 여러 기능에서 공통으로 사용되는 컴포넌트
- 네비게이션, 레이아웃 등

## 장점

1. **유지보수성**: 관련 기능들이 한 곳에 모여 있어 수정이 용이
2. **개발 효율성**: 새로운 기능 추가 시 해당 폴더에서만 작업
3. **코드 응집도**: 관련 컴포넌트들이 함께 위치하여 의존성 관리가 명확
4. **팀 협업**: 기능별로 작업 영역을 분담하기 쉬움
5. **확장성**: 새로운 AWS 서비스나 기능 추가 시 구조적으로 관리 가능

## 마이그레이션 완료
- 모든 기존 컴포넌트가 새로운 구조로 이동 완료
- 기존 import 경로는 index.js를 통해 호환성 유지
- CSS 파일들도 함께 이동하여 스타일 관리 일관성 확보