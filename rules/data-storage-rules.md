# 📊 데이터베이스 필드 사용 규칙

## 개요
각 DB 필드가 어디서 어떻게 사용되는지 정의합니다.

---

## 테이블 구조

### 사용자 테이블: `aws_v2`

| 필드 | 용도 | 사용 위치 |
|------|------|-----------|
| `userId` | 사용자 식별 | 모든 API |
| `username` | 로그인 조회 | `username-index` GSI |
| `companyName` | 프로필 표시 | `UserDashboard.js` |
| `roleArn` | AWS 권한 위임 | 검사 실행 시 |
| `status` | 접근 권한 제어 | pending/approved/rejected |
| `isAdmin` | 관리자 기능 | `UserList.js` |
| `arnValidation` | ARN 유효성 결과 | 회원가입 시 검증 |

### 검사 결과 테이블: `InspectionItemResults`

| 필드 | 용도 | 사용 위치 |
|------|------|-----------|
| `customerId` | 사용자별 데이터 분리 | 모든 검사 API |
| `itemKey` | 레코드 타입 구분 | LATEST/HISTORY 패턴 |
| `serviceType` | 서비스별 필터링 | EC2, S3, IAM 등 |
| `itemId` | 검사 항목 식별 | dangerous-ports 등 |
| `findings` | 실제 검사 결과 | 핵심 데이터 |
| `inspectionTime` | 시간순 정렬 | 히스토리 조회 |
| `inspectionId` | 검사 세션 추적 | 배치 처리 |
| `lastInspectionId` | 최신 검사 참조 | LATEST 레코드 |

---

## itemKey 패턴

### LATEST 레코드
```
형식: "LATEST#{serviceType}#{itemId}"
용도: 대시보드 현재 상태 표시
API: GET /api/inspections/items/status
```

### HISTORY 레코드
```
형식: "HISTORY#{serviceType}#{reversedTimestamp}#{itemId}#{inspectionId}"
용도: 검사 히스토리 조회 (시간순)
API: GET /api/inspections/items/history
참고: reversedTimestamp = (9999999999999 - timestamp).toString().padStart(13, '0')
```

---

## 데이터 저장 패턴

### 검사 완료 시 저장
- **위치**: `backend/services/inspectionItemService.js`
- **방식**: LATEST + HISTORY 레코드 병렬 저장
- **처리**: 각 검사 항목을 비동기로 개별 처리

### 저장 데이터 예시
```json
{
  "customerId": "user-123",
  "itemKey": "LATEST#EC2#dangerous-ports", 
  "serviceType": "EC2",
  "itemId": "dangerous-ports",
  "inspectionTime": 1640995200000,
  "lastInspectionId": "insp-abc123",
  "findings": [
    {
      "resourceId": "sg-12345678",
      "resourceType": "SecurityGroup",
      "issue": "보안 그룹 'default'에서 심각한 포트 노출: SSH 포트(22)가 인터넷 전체에 개방됨",
      "recommendation": "즉시 SSH/RDP 포트를 특정 IP로 제한하고 불필요한 규칙을 제거하세요."
    }
  ]
}
```

