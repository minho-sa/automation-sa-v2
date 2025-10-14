# 🔍 AWS 보안 검사 프로세스 가이드

## 📋 목차
1. [검사 프로세스 개요](#검사-프로세스-개요)
2. [검사 단계별 흐름](#검사-단계별-흐름)
3. [파일 구조 및 역할](#파일-구조-및-역할)
4. [데이터 저장 및 조회](#데이터-저장-및-조회)
5. [실시간 진행률 추적](#실시간-진행률-추적)

---

## 🎯 검사 프로세스 개요

AWS 보안 검사는 **단일 항목 검사**와 **배치 검사** 두 가지 방식으로 진행됩니다.

### 검사 유형
- **단일 항목 검사**: 특정 검사 항목 하나만 실행 (예: EC2 위험한 포트 검사)
- **배치 검사**: 여러 검사 항목을 동시에 실행 (예: EC2 전체 보안 검사)

---

## 🔄 검사 단계별 흐름

### 1️⃣ **검사 시작 단계**
```
사용자 요청 → InspectionController → InspectionService
```

**관련 파일:**
- `backend/controllers/inspectionController.js` - API 엔드포인트 처리
- `backend/services/inspectionService.js` - 검사 실행 조정

**처리 과정:**
1. 사용자 인증 확인
2. AWS Role ARN 검증
3. 검사 ID 생성 (UUID)
4. WebSocket 연결 설정
5. Inspector 선택 및 초기화

### 2️⃣ **AWS 자격 증명 단계**
```
STS Service → AWS AssumeRole → 임시 자격 증명 획득
```

**관련 파일:**
- `backend/services/stsService.js` - AWS STS 처리
- `backend/config/aws.js` - AWS 클라이언트 설정

**처리 과정:**
1. 사용자의 Role ARN으로 AssumeRole 실행
2. 임시 자격 증명 (AccessKey, SecretKey, SessionToken) 획득
3. AWS 서비스 클라이언트 초기화

### 3️⃣ **검사 실행 단계**
```
Inspector → Checker → AWS API 호출 → Finding 생성
```

**관련 파일:**
- `backend/services/inspectors/baseInspector.js` - 기본 Inspector 클래스
- `backend/services/inspectors/{service}/index.js` - 서비스별 Inspector
- `backend/services/inspectors/{service}/checks/*.js` - 실제 검사 로직

**처리 과정:**
1. **Inspector 초기화**
   - BaseInspector 상속
   - AWS 클라이언트 설정
   - 메타데이터 초기화

2. **Checker 실행**
   - 각 검사 항목별 Checker 호출
   - AWS API를 통한 리소스 조회
   - 보안 규칙 검증

3. **Finding 생성**
   - 문제 발견 시 InspectionFinding 객체 생성
   - 리소스 정보, 문제 설명, 권장사항 포함

### 4️⃣ **결과 저장 단계**
```
Inspector → InspectionItemService → DynamoDB
```

**관련 파일:**
- `backend/services/inspectionItemService.js` - 검사 결과 저장
- `backend/models/InspectionFinding.js` - Finding 모델
- `backend/models/InspectionItemResult.js` - 저장 스키마

**처리 과정:**
1. **결과 수집**
   - Inspector에서 모든 Finding 수집
   - 검사 요약 정보 생성

2. **데이터 변환**
   - InspectionFinding → API 응답 형식
   - 메타데이터 추가 (검사 시간, 서비스 타입 등)

3. **DynamoDB 저장**
   - LATEST 레코드: 최신 결과 (빠른 조회용)
   - HISTORY 레코드: 히스토리 (시간순 정렬)

### 5️⃣ **실시간 알림 단계**
```
WebSocketService → 클라이언트 → UI 업데이트
```

**관련 파일:**
- `backend/services/websocketService.js` - WebSocket 관리
- `frontend/src/services/websocketService.js` - 클라이언트 WebSocket

**처리 과정:**
1. 검사 진행률 실시간 전송
2. 검사 완료 알림
3. 에러 발생 시 알림

---

## 📁 파일 구조 및 역할

### 🎛️ **Controller Layer**
```
backend/controllers/
├── inspectionController.js     # 검사 API 엔드포인트
└── authController.js          # 인증 관련 API
```

### 🔧 **Service Layer**
```
backend/services/
├── inspectionService.js       # 검사 실행 조정
├── inspectionItemService.js   # 검사 결과 저장/조회
├── historyService.js         # 검사 히스토리 관리
├── websocketService.js       # 실시간 통신
├── cognitoService.js         # 사용자 인증
├── dynamoService.js          # 사용자 메타데이터
└── stsService.js             # AWS 자격 증명
```

### 🔍 **Inspector Layer**
```
backend/services/inspectors/
├── baseInspector.js          # 기본 Inspector 클래스
├── ec2/
│   ├── index.js             # EC2 Inspector
│   └── checks/
│       ├── dangerousPortsChecker.js
│       ├── ebsEncryptionChecker.js
│       └── ...
├── iam/
│   ├── index.js             # IAM Inspector
│   └── checks/
│       ├── rootAccessKeyChecker.js
│       ├── mfaChecker.js
│       └── ...
└── s3/
    ├── index.js             # S3 Inspector
    └── checks/
        ├── bucketEncryptionChecker.js
        ├── bucketPolicyChecker.js
        └── ...
```

### 📊 **Model Layer**
```
backend/models/
├── InspectionFinding.js      # 검사 문제 항목
├── InspectionItemResult.js   # DynamoDB 저장 스키마
├── InspectionStatus.js       # 검사 진행 상태
└── ApiResponse.js           # API 응답 형식
```

---

## 💾 데이터 저장 및 조회

### 🗄️ **DynamoDB 테이블 구조**

**테이블명**: `InspectionItemResults`

**Primary Key**:
- `customerId` (HASH) - 고객 ID
- `itemKey` (RANGE) - 아이템 식별키

**itemKey 구조**:
```
LATEST#{serviceType}#{itemId}     # 최신 결과
HISTORY#{serviceType}#{itemId}#{timestamp}#{inspectionId}  # 히스토리
```

### 📝 **저장 데이터 예시**

**LATEST 레코드** (빠른 조회용):
```json
{
  "customerId": "user-123",
  "itemKey": "LATEST#EC2#dangerous-ports",
  "serviceType": "EC2",
  "itemId": "dangerous-ports",
  "inspectionTime": 1640995200000,
  "status": "FAIL",
  "findings": [
    {
      "resourceId": "sg-12345678",
      "resourceType": "SecurityGroup",
      "issue": "SSH 포트(22)가 인터넷에 개방되어 있습니다",
      "recommendation": "SSH 접근을 특정 IP로 제한하세요"
    }
  ]
}
```

**HISTORY 레코드** (시간순 정렬):
```json
{
  "customerId": "user-123",
  "itemKey": "HISTORY#EC2#dangerous-ports#9999998359004800#insp-456",
  "serviceType": "EC2",
  "itemId": "dangerous-ports",
  "inspectionId": "insp-456",
  "inspectionTime": 1640995200000,
  "status": "FAIL",
  "findings": [...]
}
```

### 🔍 **조회 패턴**

**1. 최신 결과 조회**:
```javascript
// 특정 항목의 최신 결과
const itemKey = `LATEST#EC2#dangerous-ports`;
const result = await dynamoDB.get({
  Key: { customerId, itemKey }
});

// 모든 항목의 최신 결과
const results = await dynamoDB.query({
  KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :latest)',
  ExpressionAttributeValues: {
    ':customerId': customerId,
    ':latest': 'LATEST#'
  }
});
```

**2. 히스토리 조회**:
```javascript
// 특정 항목의 히스토리
const results = await dynamoDB.query({
  KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :history)',
  ExpressionAttributeValues: {
    ':customerId': customerId,
    ':history': 'HISTORY#EC2#dangerous-ports#'
  }
});
```

---

## 📡 실시간 진행률 추적

### 🔌 **WebSocket 연결**

**연결 과정**:
1. 클라이언트가 WebSocket 연결 요청
2. JWT 토큰으로 사용자 인증
3. 사용자별 연결 관리
4. 검사 ID별 구독 설정

### 📊 **진행률 메시지 형식**

**검사 시작**:
```json
{
  "type": "INSPECTION_STARTED",
  "inspectionId": "insp-123",
  "batchId": "batch-456",
  "message": "검사를 시작합니다"
}
```

**진행률 업데이트**:
```json
{
  "type": "PROGRESS_UPDATE",
  "inspectionId": "insp-123",
  "progress": {
    "currentStep": "EC2 보안 그룹 검사 중",
    "completedSteps": 3,
    "totalSteps": 10,
    "percentage": 30
  },
  "estimatedTimeRemaining": 45000
}
```

**검사 완료**:
```json
{
  "type": "INSPECTION_COMPLETED",
  "inspectionId": "insp-123",
  "results": {
    "totalIssues": 5,
    "criticalIssues": 2,
    "warnIssues": 3
  }
}
```

---

## 🎯 검사 항목별 Severity 결정

### 📋 **Severity 정의** (프론트엔드)
```javascript
// frontend/src/data/inspectionItems.js
{
  id: 'dangerous-ports',
  name: '위험한 포트 노출',
  severity: 'CRITICAL',  // CRITICAL 또는 WARN
  enabled: true
}
```

### 🔄 **상태 결정 로직** (프론트엔드)
```javascript
// frontend/src/utils/itemMappings.js
const determineStatus = (item, baseSeverity) => {
  const findings = item.findings || [];
  
  if (findings.length === 0) {
    return 'PASS';      // 문제 없음 (초록색)
  }
  
  return baseSeverity;  // CRITICAL (빨간색) 또는 WARN (노란색)
};
```

### 🎨 **UI 표시**
- **CRITICAL**: 🔴 빨간색 - 심각한 보안 문제
- **WARN**: 🟡 노란색 - 경고 수준 문제
- **PASS**: 🟢 초록색 - 문제 없음

---

## 🚀 성능 최적화

### ⚡ **빠른 조회**
- LATEST 레코드로 최신 상태 즉시 조회
- GSI(Global Secondary Index)로 다양한 조회 패턴 지원

### 📈 **확장성**
- 검사 항목별 독립적 저장
- 서비스별 Inspector 분리
- WebSocket으로 실시간 피드백

### 🔄 **데이터 일관성**
- 단순한 저장 구조로 복잡성 제거
- 트랜잭션 오버헤드 최소화
- 에러 발생 시 부분 결과 저장

---

## 📚 참고 자료

- [AWS SDK for JavaScript](https://docs.aws.amazon.com/sdk-for-javascript/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)