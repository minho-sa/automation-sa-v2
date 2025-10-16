# 프론트엔드 페이지별 플로우 및 백엔드 연동 분석

## 목차
1. [개요](#개요)
2. [인증 관련 플로우](#2-인증-관련-플로우)
   - 2.1 [회원가입 플로우 (RegisterForm.js)](#21-회원가입-플로우-registerformjs)
   - 2.2 [로그인 플로우 (LoginForm.js)](#22-로그인-플로우-loginformjs)
   - 2.3 [토큰 검증 플로우 (AuthContext.js)](#23-토큰-검증-플로우-authcontextjs)
3. [공통 인증 플로우](#3-공통-인증-플로우)
   - 3.1 [모든 API 요청의 공통 미들웨어 체인](#31-모든-api-요청의-공통-미들웨어-체인)
   - 3.2 [JWT 토큰 검증 상세 플로우](#32-jwt-토큰-검증-상세-플로우)
4. [대시보드 페이지 플로우 (UserDashboard.js)](#4-대시보드-페이지-플로우-userdashboardjs)
   - 4.1 [페이지 진입 시 자동 실행](#41-페이지-진입-시-자동-실행)
   - 4.2 [비밀번호 변경 동작](#42-비밀번호-변경-동작)
   - 4.3 [프로필 새로고침 동작](#43-프로필-새로고침-동작)
5. [리소스 검사 탭 플로우 (ResourceInspectionTab.js)](#5-리소스-검사-탭-플로우-resourceinspectiontabjs)
   - 5.1 [서비스 선택 시 상태 로드](#51-서비스-선택-시-상태-로드)
   - 5.2 [검사 시작 동작](#52-검사-시작-동작)
   - 5.3 [실시간 진행률 모니터링](#53-실시간-진행률-모니터링)
6. [검사 히스토리 플로우 (InspectionHistory.js)](#6-검사-히스토리-플로우-inspectionhistoryjs)
   - 6.1 [히스토리 목록 로드](#61-히스토리-목록-로드)
   - 6.2 [필터 변경 동작](#62-필터-변경-동작)
   - 6.3 [상세보기 모달](#63-상세보기-모달)
   - 6.4 [페이지네이션 (더 보기)](#64-페이지네이션-더-보기)
7. [관리자 패널 플로우 (UserList.js)](#7-관리자-패널-플로우-userlistjs)
   - 7.1 [사용자 목록 로드](#71-사용자-목록-로드)
   - 7.2 [사용자 승인/거부 동작](#72-사용자-승인거부-동작)
   - 7.3 [ARN 검증 동작](#73-arn-검증-동작)
   - 7.4 [검색 및 필터링](#74-검색-및-필터링)
8. [핵심 컴포넌트 및 파일 위치](#8-핵심-컴포넌트-및-파일-위치)
   - 8.1 [프론트엔드 서비스](#81-프론트엔드-서비스)
   - 8.2 [백엔드 미들웨어](#82-백엔드-미들웨어)
   - 8.3 [백엔드 컨트롤러](#83-백엔드-컨트롤러)
   - 8.4 [백엔드 서비스](#84-백엔드-서비스)
   - 8.5 [백엔드 라우트 핸들러](#85-백엔드-라우트-핸들러)
   - 8.6 [핵심 API 엔드포인트 요약](#86-핵심-api-엔드포인트-요약)

## 개요
프론트엔드의 각 페이지에서 사용자 동작 시 발생하는 API 호출과 백엔드 처리 플로우를 상세히 분석합니다.

## 2. 인증 관련 플로우

### 2.1 회원가입 플로우 (components/auth/RegisterForm.js)
**사용자 액션**: 회원가입 폼 제출

**프론트엔드 동작:**
```javascript
// components/auth/RegisterForm.js - handleSubmit
const { register } = useAuth(); // AuthContext 훅 사용
const handleSubmit = async (e) => {
  const result = await register(registrationData);
}
```

**백엔드 처리 플로우:**
```
1. API 요청: POST /api/auth/register
   Body: { username, password, roleArn, companyName }
   ↓
2. 미들웨어: validateRegistration (validation.js)
   - 이메일 형식 검증, 비밀번호 강도 검증 (소문자+숫자, 8자 이상)
   - ARN 형식 검증 (arn:aws:iam::숫자12자리:role/역할명)
   - 회사명 검증 (2자 이상)
   ↓
3. 라우터: backend/routes/auth.js
   - authController.register 함수 호출
   ↓
4. 컨트롤러: authController.register()
   - dynamoService.getUserByUsername(username) → 중복 확인
   - cognitoService.createUser(username, password) → AWS Cognito 계정 생성
   - dynamoService.createUser(userData) → 메타데이터 저장
   ↓
5. 서비스들:
   - cognitoService.createUser() → AdminCreateUserCommand + AdminSetUserPasswordCommand 실행
   - dynamoService.createUser() → PutCommand로 사용자 메타데이터 저장 (status: 'pending')
   ↓
6. 모델: AWS Cognito + DynamoDB
   - Cognito: 사용자 계정 생성 (이메일 검증됨으로 설정)
   - DynamoDB: aws_v2 테이블에 메타데이터 저장 (승인 대기 상태)
```

### 2.2 로그인 플로우 (components/auth/LoginForm.js)
**사용자 액션**: 로그인 폼 제출

**프론트엔드 동작:**
```javascript
// components/auth/LoginForm.js - handleSubmit
const handleSubmit = async (e) => {
  const response = await authService.login(credentials);
  // 성공 시 토큰을 localStorage에 저장
}
```

**백엔드 처리 플로우:**
```
1. API 요청: POST /api/auth/login
   Body: { username, password }
   ↓
2. 미들웨어: validateLogin (validation.js)
   - 필수 필드 검증 (username, password)
   - username 소문자 변환 및 trim
   ↓
3. 라우터: backend/routes/auth.js
   - authController.login 함수 호출
   ↓
4. 컨트롤러: authController.login()
   - cognitoService.authenticateUser(username, password) → AWS Cognito 인증
   - dynamoService.getUserByUsername(username) → 사용자 메타데이터 조회
   - generateToken(tokenPayload) → JWT 토큰 생성
   ↓
5. 서비스들:
   - cognitoService.authenticateUser() → AdminInitiateAuthCommand 실행
   - dynamoService.getUserByUsername() → QueryCommand (username-index 사용)
   - generateToken() → jwt.sign()으로 토큰 생성
   ↓
6. 모델: AWS Cognito + DynamoDB
   - Cognito: ADMIN_USER_PASSWORD_AUTH 플로우로 사용자 인증
   - DynamoDB: aws_v2 테이블에서 사용자 상태 및 권한 정보 조회
```

### 2.3 토큰 검증 플로우 (context/AuthContext.js)
**자동 동작**: 앱 로드 시 토큰 자동 검증

**프론트엔드 동작:**
```javascript
// context/AuthContext.js - useEffect
useEffect(() => {
  const token = localStorage.getItem('authToken');
  if (token) {
    authService.verifyToken();
  }
}, []);
```

**백엔드 처리 플로우:**
```
1. API 요청: GET /api/auth/verify
   Headers: Authorization: Bearer <token>
   ↓
2. 미들웨어: authenticateToken (auth.js)
   - Authorization 헤더에서 Bearer 토큰 추출
   - verifyToken(token) 호출로 JWT 검증
   - 토큰 페이로드에서 사용자 정보 추출하여 req.user 설정
   ↓
3. 라우터: backend/routes/auth.js
   - authController.verify 함수 호출
   ↓
4. 컨트롤러: authController.verify()
   - req.user에서 username 추출
   - dynamoService.getUserByUsername(username) → 최신 사용자 정보 조회
   ↓
4. 서비스: dynamoService.getUserByUsername()
   - QueryCommand (username-index 사용)로 사용자 최신 상태 및 권한 정보 조회
   ↓
5. 모델: DynamoDB
   - aws_v2 테이블에서 사용자 메타데이터 조회
```

## 3. 공통 인증 플로우

### 3.1 모든 API 요청의 공통 미들웨어 체인
```
1. Rate Limiting (해당하는 경우):
   - inspectionLimiter (검사 관련 API만)
   ↓
2. authenticateToken() 미들웨어 (auth.js):
   - Authorization 헤더에서 Bearer 토큰 추출
   - verifyToken(token) 호출로 JWT 검증
   - 토큰 페이로드에서 사용자 정보 추출
   - req.user에 사용자 정보 저장 (userId, username, status, isAdmin)
   ↓
3. 권한 확인 미들웨어 (필요한 경우):
   - requireApprovedUser(): req.user.status === 'approved' 확인
   - requireAdmin(): req.user.isAdmin === true 확인
   ↓
4. 입력 검증 미들웨어 (필요한 경우):
   - validateInspectionStart: serviceType, assumeRoleArn 형식 검증
   ↓
5. 비즈니스 로직 실행
```

### 3.2 JWT 토큰 검증 상세 플로우
```
1. verifyToken() (jwt.js):
   - jwt.verify(token, config.jwt.secret) 실행
   - 토큰 만료, 서명 검증
   - 에러 시 TOKEN_EXPIRED, INVALID_TOKEN 등 구체적 에러 반환
   ↓
2. 토큰 페이로드 추출:
   - userId, username, status, isAdmin
   ↓
3. req.user 객체 설정:
   - 후속 미들웨어와 컨트롤러에서 사용
```

## 4. 대시보드 페이지 플로우 (components/dashboard/UserDashboard.js)

### 4.1 페이지 진입 시 자동 실행
**컴포넌트**: `components/dashboard/UserDashboard.js` → **API**: `GET /api/users/profile`

**프론트엔드 동작:**
```javascript
// components/dashboard/UserDashboard.js - useEffect 훅
useEffect(() => {
  fetchProfile();
}, [fetchProfile]);

// fetchProfile 함수 실행
const fetchProfile = async () => {
  const response = await userService.getProfile();
}
```

**백엔드 처리 플로우:**
```
1. API 요청: GET /api/users/profile
   ↓
2. 미들웨어 체인:
   - authenticateToken() → JWT 토큰 검증, req.user 설정
   ↓
3. 라우터: backend/routes/users.js
   - 라우트 핸들러 함수 직접 실행 (별도 컨트롤러 없음)
   ↓
4. 라우트 핸들러: users.js 내부 `async (req, res) => {}` 함수
   - req.user.userId 추출
   - dynamoService.getUserById(userId) 호출
   ↓
5. 서비스: dynamoService.getUserById()
   - GetCommand 생성 및 파라미터 설정
   - this.client.send(command) 실행 (dynamoDBDocClient)
   ↓
6. 모델: DynamoDB aws_v2 테이블 조회
   - 사용자 메타데이터 반환 (status, roleArn, arnValidation 등)
```

### 4.2 비밀번호 변경 동작
**사용자 액션**: 비밀번호 변경 버튼 클릭 → 모달에서 폼 제출

**프론트엔드 동작:**
```javascript
// components/dashboard/UserDashboard.js - handlePasswordSubmit
const handlePasswordSubmit = async (e) => {
  const response = await userService.changePassword(passwordForm);
}
```

**백엔드 처리 플로우:**
```
1. API 요청: PUT /api/users/password
   ↓
2. 미들웨어 체인:
   - authenticateToken() → JWT 검증, req.user 설정
   ↓
3. 라우터: backend/routes/users.js
   - 라우트 핸들러 함수 직접 실행
   ↓
4. 라우트 핸들러: users.js 내부 `async (req, res) => {}` 함수
   - 입력 검증 (currentPassword, newPassword, confirmPassword)
   - cognitoService.authenticateUser(username, currentPassword) → 현재 비밀번호 검증
   - cognitoService.changePassword(username, newPassword) → 새 비밀번호 설정
   - dynamoService.updateUserTimestamp(userId) → 타임스탬프 업데이트
   ↓
5. 서비스들:
   - cognitoService.authenticateUser() → AdminInitiateAuthCommand 실행
   - cognitoService.changePassword() → AdminSetUserPasswordCommand 실행
   - dynamoService.updateUserTimestamp() → UpdateCommand 실행
   ↓
6. 모델: AWS Cognito + DynamoDB
   - Cognito: 비밀번호 변경
   - DynamoDB aws_v2 테이블: updatedAt 필드 갱신
```

### 4.3 프로필 새로고침 동작
**사용자 액션**: 새로고침 버튼 클릭

**동작**: 4.1과 동일한 플로우 재실행

---

## 5. 리소스 검사 탭 플로우 (components/inspection/ResourceInspectionTab.js)

### 5.1 서비스 선택 시 상태 로드
**사용자 액션**: EC2, S3 등 서비스 탭 클릭

**프론트엔드 동작:**
```javascript
// components/inspection/ServiceInspectionSelector.js - handleServiceSelect
const handleServiceSelect = async (serviceId) => {
  await loadServiceItemStatuses(serviceId);
}

// loadServiceItemStatuses 함수
const loadServiceItemStatuses = async (serviceId) => {
  const result = await inspectionService.getAllItemStatus(serviceId);
}
```

**백엔드 처리 플로우:**
```
1. API 요청: GET /api/inspections/items/status?serviceType=EC2
   ↓
2. 미들웨어 체인:
   - inspectionLimiter → Rate Limiting
   - authenticateToken() → JWT 검증, req.user 설정
   - requireApprovedUser() → 승인된 사용자 확인
   ↓
3. 컨트롤러: inspectionController.getAllItemStatus()
   - req.user.userId 추출 (customerId)
   - req.query.serviceType 추출
   - historyService.getInspectionHistory(customerId, { historyMode: 'latest', serviceType }) 호출
   ↓
4. 서비스: historyService.getInspectionHistory()
   - QueryCommand 생성 (itemKey prefix: 'LATEST#')
   - this.client.send(command) 실행 (dynamoDBDocClient)
   - 서비스 타입별 필터링 적용
   ↓
5. 모델: DynamoDB InspectionItemResults 테이블
   - 각 검사 항목별 최신 상태 반환
   - findings 배열 기반으로 PASS/FAIL 상태 결정
   - 서비스별로 그룹화하여 반환
```

### 5.2 검사 시작 동작
**사용자 액션**: ARN 입력 후 "검사 시작" 버튼 클릭

**프론트엔드 동작:**
```javascript
// components/inspection/ServiceInspectionSelector.js - handleStartInspection
const handleStartInspection = () => {
  onStartInspection({
    serviceType: selectedService,
    assumeRoleArn,
    inspectionConfig: { selectedItems: selectedItemIds }
  });
}

// components/inspection/ResourceInspectionTab.js - handleStartInspection
const { startInspection } = useInspectionStarter(); // 커스텀 훅 사용
const handleStartInspection = async (inspectionRequest) => {
  const result = await startInspection(
    inspectionRequest.serviceType,
    inspectionRequest.inspectionConfig?.selectedItems || [],
    inspectionRequest.assumeRoleArn
  );
}
```

**백엔드 처리 플로우:**
```
1. API 요청: POST /api/inspections/start
   Body: { serviceType, assumeRoleArn, inspectionConfig }
   ↓
2. 미들웨어 체인:
   - inspectionLimiter → Rate Limiting
   - authenticateToken() → JWT 검증, req.user 설정
   - requireApprovedUser() → 승인된 사용자 확인
   - validateInspectionStart → 입력 검증 (serviceType, assumeRoleArn 형식)
   ↓
3. 컨트롤러: inspectionController.startInspection()
   - req.user.userId 추출 (customerId)
   - 입력 검증 (serviceType, assumeRoleArn)
   - inspectionService.startInspection(customerId, serviceType, assumeRoleArn, inspectionConfig) 호출
   ↓
4. 서비스: inspectionService.startInspection()
   - 배치 ID 생성 (uuidv4())
   - selectedItems 기반으로 검사 작업 생성
   - this.activeBatches Map에 배치 정보 등록
   - this.executeItemInspectionAsync() 비동기 실행 (각 항목별)
   ↓
5. 개별 검사 실행: inspectionService.executeItemInspectionAsync()
   - this.assumeRole(roleArn, inspectionId) → AssumeRoleCommand 실행
   - inspectorRegistry.getInspector(serviceType) → 서비스별 Inspector 획득
   - inspector.executeItemInspection() → 실제 AWS 리소스 검사
   - this.saveInspectionItemResults() → inspectionItemService.saveItemResult() 호출
   ↓
6. WebSocket 알림: webSocketService.broadcastProgressUpdate()
   - 실시간 진행률 업데이트
   - 배치 진행률 계산 및 전송
   ↓
7. 모델들:
   - AWS STS: AssumeRoleCommand로 임시 자격 증명 획득
   - AWS 서비스들: EC2, S3, RDS 등 실제 리소스 검사
   - DynamoDB: InspectionItemResults 테이블에 검사 결과 저장
```

### 5.3 실시간 진행률 모니터링
**자동 동작**: WebSocket을 통한 실시간 업데이트

**프론트엔드 동작:**
```javascript
// components/inspection/progress/EnhancedProgressMonitor.js - WebSocket 구독
useEffect(() => {
  const monitoring = inspectionService.startWebSocketMonitoring(inspectionId, {
    onProgress: (data) => setProgress(data),
    onComplete: (data) => handleComplete(data)
  });
}, [inspectionId]);
```

**백엔드 WebSocket 플로우:**
```
1. WebSocket 연결: webSocketService.connect()
   ↓
2. 검사 진행 중: InspectionService.executeItemInspectionAsync()
   - 각 단계별로 webSocketService.broadcastProgressUpdate() 호출
   ↓
3. WebSocket 서비스: webSocketService.broadcastProgressUpdate()
   - 연결된 클라이언트들에게 진행률 전송
   - 배치 진행률 계산 및 전송
   ↓
4. 검사 완료: InspectionService.broadcastBatchCompletion()
   - 최종 완료 알림 전송
   - 프론트엔드에서 결과 화면으로 전환
```

---

## 6. 검사 히스토리 플로우 (components/history/InspectionHistory.js)

### 6.1 히스토리 목록 로드
**페이지 진입 시**: 자동으로 검사 히스토리 로드

**프론트엔드 동작:**
```javascript
// components/history/InspectionHistory.js - useEffect
useEffect(() => {
  loadInspectionHistory();
}, [filters]);

// loadInspectionHistory 함수
const loadInspectionHistory = async (loadMore = false) => {
  const result = await inspectionService.getItemInspectionHistory(params);
}
```

**백엔드 처리 플로우:**
```
1. API 요청: GET /api/inspections/items/history?serviceType=EC2&historyMode=history
   ↓
2. 미들웨어 체인:
   - inspectionLimiter → Rate Limiting
   - authenticateToken() → JWT 검증, req.user 설정
   - requireApprovedUser() → 승인된 사용자 확인
   ↓
3. 컨트롤러: inspectionController.getItemInspectionHistory()
   - req.user.userId 추출 (customerId)
   - 쿼리 파라미터 추출 (serviceType, historyMode, lastEvaluatedKey)
   - historyService.getInspectionHistory(customerId, options) 호출
   ↓
4. 서비스: historyService.getInspectionHistory()
   - QueryCommand 생성 (itemKey prefix: 'HISTORY#')
   - 페이지네이션 지원 (HistoryService.DEFAULT_PAGE_SIZE = 10)
   - this.client.send(command) 실행 (dynamoDBDocClient)
   - 시간순 정렬 (ScanIndexForward: false)
   ↓
5. 모델: DynamoDB InspectionItemResults 테이블
   - 검사 항목별 상세 이력 반환
   - lastEvaluatedKey와 함께 페이지네이션 지원
```

### 6.2 필터 변경 동작
**사용자 액션**: 서비스 타입 필터 변경

**프론트엔드 동작:**
```javascript
// components/history/InspectionHistory.js - handleFilterChange
const handleFilterChange = (filterType, value) => {
  setFilters(prev => ({ ...prev, [filterType]: value }));
  // useEffect에 의해 자동으로 loadInspectionHistory() 재실행
}
```

**백엔드 처리: 6.1과 동일하지만 다른 serviceType 파라미터로 요청**

### 6.3 상세보기 모달
**사용자 액션**: 검사 항목의 "상세보기" 버튼 클릭

**프론트엔드 동작:**
```javascript
// components/history/InspectionHistory.js - handleViewItemDetails
const handleViewItemDetails = (item) => {
  // 이미 로드된 데이터를 모달로 표시 (추가 API 호출 없음)
  setSelectedInspection(inspectionData);
}
```

**백엔드 처리: 없음 (이미 로드된 데이터 활용)**

### 6.4 페이지네이션 (더 보기)
**사용자 액션**: "더 많은 기록 보기" 버튼 클릭

**프론트엔드 동작:**
```javascript
// components/history/InspectionHistory.js - loadMore
const loadMore = () => {
  loadInspectionHistory(true); // loadMore = true로 호출
}
```

**백엔드 처리: 6.1과 동일하지만 lastEvaluatedKey 파라미터 포함**

---

## 7. 관리자 패널 플로우 (components/admin/UserList.js)

### 7.1 사용자 목록 로드
**페이지 진입 시**: 전체 사용자 목록 로드

**프론트엔드 동작:**
```javascript
// components/admin/UserList.js - useEffect
useEffect(() => {
  fetchUsers();
}, []);

// fetchUsers 함수
const fetchUsers = async () => {
  const response = await adminService.getAllUsers();
}
```

**백엔드 처리 플로우:**
```
1. API 요청: GET /api/admin/users
   ↓
2. 미들웨어 체인:
   - authenticateToken() → JWT 검증, req.user 설정
   - requireAdmin() → 관리자 권한 확인 (req.user.isAdmin === true)
   ↓
3. 라우터: backend/routes/admin.js
   - 라우트 핸들러 함수 직접 실행
   ↓
4. 라우트 핸들러: admin.js 내부 `async (req, res) => {}` 함수
   - dynamoService.getAllUsers() 호출
   - 사용자 목록을 요구사항에 맞는 형태로 변환
   ↓
5. 서비스: dynamoService.getAllUsers()
   - ScanCommand 생성 및 실행
   - dynamoDBDocClient.send(command) 실행
   ↓
6. 모델: DynamoDB 사용자 테이블 (aws_v2)
   - 모든 사용자 메타데이터 반환 (userId, username, status, roleArn, arnValidation 등)
```

### 7.2 사용자 승인/거부 동작
**사용자 액션**: 승인 또는 거부 버튼 클릭

**프론트엔드 동작:**
```javascript
// components/admin/UserList.js - handleStatusChange
const handleStatusChange = async (userId, newStatus) => {
  const response = await adminService.updateUserStatus(userId, newStatus);
}
```

**백엔드 처리 플로우:**
```
1. API 요청: PUT /api/admin/users/{userId}/status
   Body: { status: "approved" }
   ↓
2. 미들웨어 체인:
   - authenticateToken() → JWT 검증, req.user 설정
   - requireAdmin() → 관리자 권한 확인 (req.user.isAdmin === true)
   ↓
3. 라우터: backend/routes/admin.js
   - 라우트 핸들러 함수 직접 실행
   ↓
4. 라우트 핸들러: admin.js 내부 `async (req, res) => {}` 함수
   - req.params.userId와 req.body.status 추출
   - 입력 검증 (userId 존재, status가 'approved' 또는 'rejected')
   - dynamoService.updateUserStatus(userId, status) 호출
   ↓
5. 서비스: dynamoService.updateUserStatus()
   - UpdateCommand 생성 (Key: { userId })
   - status와 updatedAt 필드 업데이트
   - ConditionExpression으로 사용자 존재 확인
   - dynamoDBDocClient.send(command) 실행
   ↓
6. 모델: DynamoDB 사용자 테이블 (aws_v2)
   - 사용자 상태 업데이트 (pending → approved/rejected)
   - ReturnValues: 'ALL_NEW'로 업데이트된 사용자 정보 반환
```

### 7.3 ARN 검증 동작
**사용자 액션**: "ARN 검증" 버튼 클릭

**프론트엔드 동작:**
```javascript
// components/admin/UserList.js - handleArnValidation
const handleArnValidation = async (userId) => {
  const response = await adminService.validateUserArn(userId);
}
```

**백엔드 처리 플로우:**
```
1. API 요청: POST /api/admin/users/{userId}/validate-arn
   ↓
2. 미들웨어 체인:
   - authenticateToken() → JWT 검증, req.user 설정
   - requireAdmin() → 관리자 권한 확인 (req.user.isAdmin === true)
   ↓
3. 라우터: backend/routes/admin.js
   - 라우트 핸들러 함수 직접 실행
   ↓
4. 라우트 핸들러: admin.js 내부 `async (req, res) => {}` 함수
   - req.params.userId 추출 및 검증
   - dynamoService.getUserById(userId) → 사용자 정보 및 roleArn 조회
   - stsService.validateRoleArn(roleArn, sessionName) → AWS STS로 ARN 검증
   - dynamoService.updateArnValidation(userId, isValid, error) → 검증 결과 저장
   ↓
5. 서비스들:
   - dynamoService.getUserById() → GetCommand로 사용자 정보 조회
   - stsService.validateRoleArn() → AssumeRoleCommand 테스트 실행
   - dynamoService.updateArnValidation() → UpdateCommand로 arnValidation 필드 업데이트
   ↓
6. 모델들:
   - DynamoDB: aws_v2 테이블에서 사용자 정보 조회 및 검증 결과 저장
   - AWS STS: AssumeRoleCommand로 Role ARN 유효성 검증
```

### 7.4 검색 및 필터링
**사용자 액션**: 검색어 입력 또는 상태 필터 변경

**프론트엔드 동작:**
```javascript
// components/admin/UserList.js - 클라이언트 사이드 필터링
const filteredUsers = useMemo(() => {
  // 이미 로드된 사용자 목록을 클라이언트에서 필터링
  return users.filter(user => /* 필터 조건 */);
}, [users, filterStatus, searchTerm]);
```

**백엔드 처리: 없음 (클라이언트 사이드 필터링)**

---

## 8. 핵심 컴포넌트 및 파일 위치

### 8.1 프론트엔드 서비스
```
authService (frontend/src/services/authService.js)
- register(), login(), verifyToken(), logout()

userService (frontend/src/services/userService.js)  
- getProfile(), changePassword()

adminService (frontend/src/services/adminService.js)
- getAllUsers(), updateUserStatus(), validateUserArn()

inspectionService (frontend/src/services/inspectionService.js)
- startInspection(), getAllItemStatus(), getItemInspectionHistory()
```

### 8.2 백엔드 미들웨어
```
validation.js (backend/middleware/validation.js)
- validateRegistration, validateLogin, validateInspectionStart, validateStatusUpdate

auth.js (backend/middleware/auth.js)
- authenticateToken, requireAdmin, requireApprovedUser
```

### 8.3 백엔드 컨트롤러
```
authController.js (backend/controllers/authController.js)
- register(), login(), verify()

inspectionController.js (backend/controllers/inspectionController.js)
- startInspection(), getAllItemStatus(), getItemInspectionHistory()
```

### 8.4 백엔드 서비스
```
dynamoService.js (backend/services/dynamoService.js)
- createUser(), getUserById(), getUserByUsername(), updateUserStatus(), updateArnValidation(), getAllUsers(), updateUserTimestamp()

cognitoService.js (backend/services/cognitoService.js)
- createUser(), authenticateUser(), changePassword()

inspectionService.js (backend/services/inspectionService.js)
- startInspection(), executeItemInspectionAsync(), assumeRole(), saveInspectionItemResults()

historyService.js (backend/services/historyService.js)
- getInspectionHistory()
```

### 8.5 백엔드 라우트 핸들러
```
auth.js (backend/routes/auth.js)
- POST /register, POST /login, GET /verify

users.js (backend/routes/users.js)  
- GET /profile, PUT /password, GET /dashboard

admin.js (backend/routes/admin.js)
- GET /users, PUT /users/:id/status, POST /users/:id/validate-arn

inspections.js (backend/routes/inspections.js)
- POST /start, GET /items/status, GET /items/history
```

### 8.6 핵심 API 엔드포인트 요약

**인증 관련 API**
```
POST /api/auth/register    → validateRegistration → authController.register()
POST /api/auth/login       → validateLogin → authController.login()  
GET  /api/auth/verify      → authenticateToken → authController.verify()
```

**사용자 관련 API**
```
GET  /api/users/profile    → authenticateToken → users.js async 핸들러
PUT  /api/users/password   → authenticateToken → users.js async 핸들러
GET  /api/users/dashboard  → authenticateToken + requireApprovedUser → users.js async 핸들러
```

**검사 관련 API**
```
POST /api/inspections/start         → inspectionLimiter + authenticateToken + requireApprovedUser + validateInspectionStart → inspectionController.startInspection()
GET  /api/inspections/items/status  → inspectionLimiter + authenticateToken + requireApprovedUser → inspectionController.getAllItemStatus()
GET  /api/inspections/items/history → inspectionLimiter + authenticateToken + requireApprovedUser → inspectionController.getItemInspectionHistory()
```

**관리자 관련 API**
```
GET  /api/admin/users                      → authenticateToken + requireAdmin → admin.js async 핸들러
PUT  /api/admin/users/{userId}/status      → authenticateToken + requireAdmin → admin.js async 핸들러  
POST /api/admin/users/{userId}/validate-arn → authenticateToken + requireAdmin → admin.js async 핸들러
```

이 분석을 통해 각 페이지에서의 사용자 동작이 어떤 API를 호출하고, 백엔드에서 어떤 미들웨어, 컨트롤러, 서비스, 모델들이 순차적으로 동작하는지 명확히 파악할 수 있습니다.