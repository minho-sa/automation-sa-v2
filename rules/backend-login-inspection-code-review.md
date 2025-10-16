# 프론트엔드 페이지별 플로우 및 백엔드 연동 분석

## 개요
프론트엔드의 각 페이지에서 사용자 동작 시 발생하는 API 호출과 백엔드 처리 플로우를 상세히 분석합니다.

## 1. 사용자 인증 및 로그인 플로우

### 1.1 AuthController 클래스
**파일**: `backend/controllers/authController.js`

#### 주요 메서드:
- `register(req, res)`: 회원가입 처리
- `login(req, res)`: 로그인 처리  
- `verify(req, res)`: JWT 토큰 검증

#### 로그인 메서드 상세 분석:
```javascript
// AuthController.login() 메서드 흐름
1. cognitoService.authenticateUser(username, password)  // AWS Cognito 인증
2. dynamoService.getUserByUsername(username)           // 사용자 메타데이터 조회
3. generateToken(tokenPayload)                         // JWT 토큰 생성
4. 응답 반환 (토큰 + 사용자 정보)
```

### 1.2 CognitoService 클래스
**파일**: `backend/services/cognitoService.js`

#### 주요 메서드:
- `createUser(username, password, email)`: AWS Cognito 사용자 생성
- `authenticateUser(username, password)`: AWS Cognito 인증 수행
- `changePassword(username, newPassword)`: 비밀번호 변경

#### 인증 메서드 상세:
```javascript
// CognitoService.authenticateUser() 내부 로직
1. AdminInitiateAuthCommand 생성
2. cognitoClient.send(command) 실행
3. AuthenticationResult 반환 (AccessToken, IdToken, RefreshToken)
```

### 1.3 DynamoService 클래스
**파일**: `backend/services/dynamoService.js`

#### 주요 메서드:
- `createUser(userData)`: 사용자 메타데이터 생성
- `getUserById(userId)`: ID로 사용자 조회
- `getUserByUsername(username)`: 사용자명으로 조회
- `updateUserStatus(userId, status)`: 사용자 상태 변경
- `updateArnValidation(userId, isValid, error)`: ARN 검증 결과 저장
- `getAllUsers()`: 전체 사용자 목록 조회
- `updateUserTimestamp(userId)`: 사용자 활동 시간 업데이트

#### 사용자 조회 메서드 상세:
```javascript
// DynamoService.getUserByUsername() 내부 로직
1. QueryCommand 생성 (username-index 사용)
2. dynamoDBDocClient.send(command) 실행
3. 사용자 메타데이터 반환 (status, isAdmin, roleArn 등)
```

### 1.4 JWT 유틸리티
**파일**: `backend/utils/jwt.js`

#### 주요 함수:
- `generateToken(payload)`: JWT 토큰 생성
- `verifyToken(token)`: JWT 토큰 검증
- `decodeToken(token)`: JWT 토큰 디코딩

## 2. 인증 미들웨어 체계

### 2.1 Auth 미들웨어
**파일**: `backend/middleware/auth.js`

#### 주요 미들웨어 함수:
- `authenticateToken(req, res, next)`: JWT 토큰 검증 및 사용자 정보 추출
- `requireAdmin(req, res, next)`: 관리자 권한 확인
- `requireApprovedUser(req, res, next)`: 승인된 사용자 상태 확인

#### 토큰 검증 미들웨어 상세:
```javascript
// authenticateToken() 미들웨어 흐름
1. Authorization 헤더에서 Bearer 토큰 추출
2. verifyToken(token) 호출로 JWT 검증
3. 토큰 페이로드에서 사용자 정보 추출
4. req.user에 사용자 정보 저장 (userId, username, status, isAdmin)
5. next() 호출로 다음 미들웨어 진행
```

## 3. 검사 로직 플로우

### 3.1 InspectionController 클래스
**파일**: `backend/controllers/inspectionController.js`

#### 주요 메서드:
- `startInspection(req, res)`: 검사 시작 엔드포인트
- `getAllItemStatus(req, res)`: 검사 항목 상태 조회
- `getItemInspectionHistory(req, res)`: 검사 이력 조회

#### 검사 시작 메서드 상세:
```javascript
// InspectionController.startInspection() 흐름
1. req.user.userId에서 고객 ID 추출 (JWT 미들웨어에서 설정)
2. 입력 검증 (serviceType, assumeRoleArn)
3. inspectionService.startInspection() 호출
4. 배치 방식 또는 단일 검사 방식 응답 처리
```

### 3.2 InspectionService 클래스
**파일**: `backend/services/inspectionService.js`

#### 주요 메서드:
- `startInspection(customerId, serviceType, assumeRoleArn, inspectionConfig)`: 검사 오케스트레이션
- `executeItemInspectionAsync(customerId, inspectionId, serviceType, assumeRoleArn, inspectionConfig)`: 개별 항목 검사 실행
- `assumeRole(roleArn, inspectionId)`: AWS Role 가정
- `saveInspectionItemResults(itemResults, metadata)`: 검사 결과 저장
- `calculateBatchProgress(batchId)`: 배치 진행률 계산
- `broadcastBatchCompletion(batchId, inspectionJobs, error)`: 배치 완료 알림

#### 검사 시작 메서드 상세:
```javascript
// InspectionService.startInspection() 내부 로직
1. 배치 ID 생성 (uuidv4())
2. 선택된 항목별로 검사 작업 생성
3. activeBatches Map에 배치 정보 등록
4. activeInspections Map에 각 검사 상태 초기화
5. webSocketService.broadcastProgressUpdate() 호출
6. executeItemInspectionAsync() 비동기 실행
7. Promise.all()로 모든 검사 완료 대기
```

#### 개별 검사 실행 메서드 상세:
```javascript
// InspectionService.executeItemInspectionAsync() 흐름
1. assumeRole() 호출로 AWS 자격 증명 획득
2. inspectorRegistry.getInspector(serviceType) 호출
3. inspector.executeItemInspection() 실행
4. saveInspectionItemResults() 호출로 결과 저장
5. webSocketService.broadcastProgressUpdate() 진행률 업데이트
```

### 3.3 STS 서비스 (Role 가정)
**파일**: `backend/services/stsService.js` (참조됨)

#### 주요 메서드:
- `isValidArnFormat(roleArn)`: ARN 형식 검증
- AWS STS AssumeRoleCommand 실행

#### Role 가정 프로세스:
```javascript
// InspectionService.assumeRole() 내부 로직
1. stsService.isValidArnFormat(roleArn) 검증
2. AssumeRoleCommand 생성 (1시간 세션, ExternalId 포함)
3. stsService.client.send(command) 실행
4. AWS 자격 증명 반환 (accessKeyId, secretAccessKey, sessionToken)
```

## 4. 라우팅 및 미들웨어 적용

### 4.1 인증 라우트
**파일**: `backend/routes/auth.js`

#### 라우트 구성:
```javascript
POST /api/auth/register → validateRegistration → AuthController.register()
POST /api/auth/login    → validateLogin → AuthController.login()
GET  /api/auth/verify   → authenticateToken → AuthController.verify()
```

### 4.2 검사 라우트
**파일**: `backend/routes/inspections.js`

#### 미들웨어 체인:
```javascript
// 모든 검사 라우트에 적용되는 미들웨어 순서
1. inspectionLimiter (Rate Limiting)
2. authenticateToken (JWT 검증)
3. requireApprovedUser (승인된 사용자만)
```

#### 라우트 구성:
```javascript
POST /api/inspections/start → validateInspectionStart → InspectionController.startInspection()
GET  /api/inspections/items/status → InspectionController.getAllItemStatus()
GET  /api/inspections/items/history → InspectionController.getItemInspectionHistory()
```

## 5. 데이터 흐름 및 상태 관리

### 5.1 사용자 인증 데이터 흐름
```
1. 프론트엔드 로그인 요청
   ↓
2. AuthController.login()
   ↓
3. CognitoService.authenticateUser() → AWS Cognito 인증
   ↓
4. DynamoService.getUserByUsername() → 사용자 메타데이터 조회
   ↓
5. generateToken() → JWT 토큰 생성
   ↓
6. 프론트엔드에 토큰 + 사용자 정보 반환
```

### 5.2 검사 요청 데이터 흐름
```
1. 프론트엔드 검사 시작 요청 (JWT 토큰 포함)
   ↓
2. authenticateToken 미들웨어 → JWT 검증 및 req.user 설정
   ↓
3. requireApprovedUser 미들웨어 → 사용자 상태 확인
   ↓
4. InspectionController.startInspection() → 요청 처리
   ↓
5. InspectionService.startInspection() → 검사 오케스트레이션
   ↓
6. InspectionService.assumeRole() → AWS Role 가정
   ↓
7. Inspector 실행 → AWS 리소스 검사
   ↓
8. 결과 저장 및 WebSocket 알림
```

## 6. 핵심 클래스 간 의존성

### 6.1 Controller 계층 의존성
```
AuthController → CognitoService, DynamoService, JWT Utils
InspectionController → InspectionService, HistoryService
```

### 6.2 Service 계층 의존성
```
InspectionService → StsService, InspectorRegistry, WebSocketService, InspectionItemService
CognitoService → AWS Cognito Client
DynamoService → AWS DynamoDB Client
```

### 6.3 미들웨어 의존성
```
authenticateToken → JWT Utils
requireApprovedUser → authenticateToken (선행 필요)
requireAdmin → authenticateToken (선행 필요)
```

## 7. 보안 및 권한 제어

### 7.1 다층 보안 구조
```
1. 네트워크 계층: CORS, Rate Limiting, Helmet
2. 인증 계층: JWT 토큰 검증
3. 권한 계층: 사용자 상태 및 관리자 권한 확인
4. 데이터 계층: AWS 관리형 서비스 보안
```

### 7.2 권한 검증 체인
```
JWT 검증 → 사용자 상태 확인 → 관리자 권한 확인 → 비즈니스 로직 실행
```

## 8. 주요 개선 사항 및 권장사항

### 8.1 코드 품질
- CommonJS에서 ES Module로 전환 고려
- TypeScript 도입으로 타입 안전성 강화
- 에러 처리 표준화 및 로깅 개선

### 8.2 성능 최적화
- DynamoDB 쿼리 최적화 (GSI 활용)
- 검사 결과 캐싱 전략 도입
- 배치 처리 성능 모니터링

### 8.3 보안 강화
- JWT 토큰 갱신 메커니즘 구현
- API Rate Limiting 세분화
- 민감한 정보 로깅 방지

이 코드 리뷰는 백엔드의 사용자 인증부터 AWS 리소스 검사까지의 전체 플로우를 클래스와 메서드 중심으로 분석하여, 시스템의 구조와 데이터 흐름을 명확히 파악할 수 있도록 정리했습니다.