# 사용자 세션 관리 및 인증 시스템 아키텍처

## 시스템 개요
AWS Cognito + DynamoDB + JWT 토큰 기반의 하이브리드 인증 시스템

### 아키텍처 패턴
```
Frontend → API → Middleware → Controller → Service → Model(AWS)
```

## 프론트엔드 페이지별 API 요청 흐름

### 1. 회원가입 페이지 (RegisterPage.js → RegisterForm.js)

**사용자 액션**: 회원가입 폼 제출
```
Frontend: RegisterForm.js
↓ authService.register()
API: POST /api/auth/register
↓ validateRegistration (미들웨어)
Controller: authController.register()
↓
Service: dynamoService.getUserByUsername() (중복 확인)
Service: cognitoService.createUser() (AWS 계정 생성)
Service: dynamoService.createUser() (메타데이터 저장)
↓
Model: AWS Cognito + DynamoDB
```

### 2. 로그인 페이지 (LoginPage.js → LoginForm.js)

**사용자 액션**: 로그인 폼 제출
```
Frontend: LoginForm.js
↓ authService.login()
API: POST /api/auth/login
↓ validateLogin (미들웨어)
Controller: authController.login()
↓
Service: cognitoService.authenticateUser() (AWS 인증)
Service: dynamoService.getUserByUsername() (권한/상태 조회)
Service: generateToken() (JWT 생성)
↓
Model: AWS Cognito + DynamoDB
```

### 3. 앱 초기화 (AuthContext.js)

**시스템 액션**: 앱 로드 시 토큰 자동 검증
```
Frontend: AuthContext.js (useEffect)
↓ authService.verifyToken()
API: GET /api/auth/verify
↓ authenticateToken (미들웨어)
Controller: authController.verify()
↓
Service: dynamoService.getUserByUsername() (최신 사용자 정보)
↓
Model: DynamoDB
```

### 4. 사용자 대시보드 (UserDashboardPage.js → UserDashboard.js)

#### 4-1. 프로필 정보 조회
**사용자 액션**: 대시보드 페이지 접근
```
Frontend: UserDashboard.js
↓ API 호출
API: GET /api/users/profile
↓ authenticateToken (미들웨어)
Controller: userController (routes/users.js)
↓
Service: dynamoService.getUserById() (완전한 사용자 정보)
↓
Model: DynamoDB
```

#### 4-2. 비밀번호 변경
**사용자 액션**: 설정 모달에서 비밀번호 변경
```
Frontend: UserDashboard.js (설정 모달)
↓ API 호출
API: PUT /api/users/password
↓ authenticateToken (미들웨어)
Controller: userController (routes/users.js)
↓
Service: cognitoService.authenticateUser() (현재 비밀번호 확인)
Service: cognitoService.changePassword() (새 비밀번호 설정)
Service: dynamoService.updateUserTimestamp() (업데이트 시간 기록)
↓
Model: AWS Cognito + DynamoDB
```

#### 4-3. 승인된 사용자 기능 접근
**사용자 액션**: 특정 기능 접근 (승인된 사용자만)
```
Frontend: UserDashboard.js
↓ API 호출
API: GET /api/users/dashboard
↓ authenticateToken → requireApprovedUser (미들웨어 체인)
Controller: userController (routes/users.js)
↓
Service: (별도 서비스 호출 없음, 미들웨어에서 권한 확인)
```

### 5. 관리자 페이지 (AdminPage.js → UserList.js)

#### 5-1. 사용자 목록 조회
**관리자 액션**: 관리자 페이지 접근
```
Frontend: UserList.js
↓ adminService.getUsers()
API: GET /api/admin/users
↓ authenticateToken → requireAdmin (미들웨어 체인)
Controller: adminController (routes/admin.js)
↓
Service: dynamoService.getAllUsers() (모든 사용자 조회)
↓
Model: DynamoDB
```

#### 5-2. 사용자 승인/거부
**관리자 액션**: 승인/거부 버튼 클릭
```
Frontend: UserList.js (승인/거부 버튼)
↓ adminService.updateUserStatus()
API: PUT /api/admin/users/{userId}/status
↓ authenticateToken → requireAdmin (미들웨어 체인)
Controller: adminController (routes/admin.js)
↓
Service: dynamoService.updateUserStatus() (상태 변경)
↓
Model: DynamoDB
```

#### 5-3. ARN 검증
**관리자 액션**: ARN 검증 버튼 클릭
```
Frontend: UserList.js (ARN 검증 버튼)
↓ adminService.validateArn()
API: POST /api/admin/users/{userId}/validate-arn
↓ authenticateToken → requireAdmin (미들웨어 체인)
Controller: adminController (routes/admin.js)
↓
Service: dynamoService.getUserById() (사용자 ARN 조회)
Service: stsService.validateRoleArn() (AWS STS로 ARN 검증)
Service: dynamoService.updateArnValidation() (검증 결과 저장)
↓
Model: DynamoDB + AWS STS
```

## 계층별 구성 요소

### API 엔드포인트
```javascript
// 인증 관련 (공개)
POST /api/auth/register     // 회원가입
POST /api/auth/login        // 로그인
GET  /api/auth/verify       // 토큰 검증

// 사용자 기능 (인증 필요)
GET  /api/users/profile     // 프로필 조회
PUT  /api/users/password    // 비밀번호 변경
GET  /api/users/dashboard   // 대시보드 (승인된 사용자만)

// 관리자 기능 (관리자 권한 필요)
GET  /api/admin/users                        // 사용자 목록
PUT  /api/admin/users/{userId}/status        // 사용자 승인/거부
POST /api/admin/users/{userId}/validate-arn  // ARN 검증
```

### Controller 계층
```javascript
// authController.js
register()    // 회원가입 처리
login()       // 로그인 처리  
verify()      // 토큰 검증 처리

// userController (routes/users.js)
profile()     // 프로필 조회 처리
password()    // 비밀번호 변경 처리
dashboard()   // 대시보드 접근 처리

// adminController (routes/admin.js)
getUsers()    // 사용자 목록 조회 처리
updateStatus() // 사용자 상태 변경 처리
validateArn() // ARN 검증 처리
```

### Service 계층

#### CognitoService (AWS 인증 전용)
```javascript
createUser(username, password, email)    // AWS 계정 생성
authenticateUser(username, password)     // AWS 인증 확인
changePassword(username, newPassword)    // AWS 비밀번호 변경
```

#### DynamoService (비즈니스 로직 + 메타데이터)
```javascript
createUser(userData)                        // 사용자 메타데이터 생성
getUserById(userId)                         // ID로 사용자 조회
getUserByUsername(username)                 // 사용자명으로 조회
updateUserStatus(userId, status)            // 상태 변경
updateArnValidation(userId, isValid, error) // ARN 검증 결과 저장
getAllUsers()                               // 전체 사용자 목록
updateUserTimestamp(userId)                 // 활동 시간 업데이트
```

#### StsService (AWS 권한 검증)
```javascript
validateRoleArn(roleArn, sessionName)      // AWS Role ARN 검증
```

### Model 계층 (AWS 서비스)
```javascript
// AWS Cognito - 인증 정보 저장
{
  Username: "user@example.com",
  UserAttributes: [email, email_verified],
  UserStatus: "CONFIRMED"
}

// DynamoDB - 애플리케이션 메타데이터
{
  userId: "uuid",
  username: "user@example.com", 
  companyName: "회사명",
  roleArn: "arn:aws:iam::123456789012:role/MyRole",
  status: "pending|approved|rejected",
  isAdmin: false,
  arnValidation: { isValid, lastChecked, error }
}
```

## 미들웨어 체인

### 전역 미들웨어 (app.js)
```
1. helmet() - 보안 헤더
2. cors() - CORS 설정
3. express.json() - JSON 파싱
4. generalLimiter - Rate Limiting (WebSocket 제외)
5. requestLogger - 요청 로깅 (개발환경만)
```

### 인증 미들웨어 체인
```
1. authenticateToken
   - Authorization 헤더 확인
   - Bearer 토큰 추출
   - JWT 검증
   - req.user에 사용자 정보 저장

2. requireApprovedUser (authenticateToken 이후)
   - req.user.status === 'approved' 확인
   - pending/rejected 사용자 접근 차단

3. requireAdmin (authenticateToken 이후)
   - req.user.isAdmin === true 확인
   - 일반 사용자 관리자 기능 접근 차단
```

### 검증 미들웨어
```
validateRegistration - 회원가입 입력 검증 (username, password, roleArn, companyName)
validateLogin - 로그인 입력 검증 (username, password)
```

## 프론트엔드 서비스 계층

### AuthService (frontend/src/services/authService.js)
```javascript
register(userData)    // 회원가입 API 호출
login(credentials)    // 로그인 API 호출  
verifyToken()         // 토큰 검증 API 호출
logout()              // 로컬 토큰 삭제
```

### AdminService (frontend/src/services/adminService.js)
```javascript
getUsers()                    // 사용자 목록 조회
updateUserStatus(userId, status) // 사용자 상태 변경
validateArn(userId)           // ARN 검증
```

### UserService (frontend/src/services/userService.js)
```javascript
getProfile()          // 프로필 조회
updatePassword()      // 비밀번호 변경
getDashboard()        // 대시보드 데이터 조회
```

## 상태 관리 및 라우팅

### AuthContext (전역 상태)
```javascript
// 상태
isAuthenticated: boolean
user: object
userRole: 'admin' | 'user'
userStatus: 'pending' | 'approved' | 'rejected'
loading: boolean

// 액션
login(credentials)
register(userData)  
logout()
updateUserStatus(newStatus)
```

### ProtectedRoute (권한 기반 라우팅)
```javascript
// 인증 확인
if (!isAuthenticated) → redirect to /login

// 상태별 접근 제어
if (userStatus === 'pending') → 제한된 접근
if (userStatus === 'rejected') → 접근 거부
if (userStatus === 'approved') → 전체 접근

// 관리자 권한
if (userRole === 'admin') → 관리자 페이지 접근 가능
```

## 데이터 모델 구조

### JWT 토큰 페이로드
```javascript
{
  userId: "uuid",
  username: "user@example.com",
  status: "approved",
  isAdmin: false,
  iat: 1642234567,    // 발급 시간
  exp: 1642320967     // 만료 시간
}
```

### 사용자 상태 흐름
```
회원가입 → status: 'pending' (대기)
         ↓
관리자 검토 → status: 'approved' (승인) 또는 'rejected' (거부)
         ↓
승인된 사용자만 → 전체 기능 접근 가능
```

## 보안 및 검증 체계

### 다층 보안 구조
1. **프론트엔드**: AuthContext + ProtectedRoute로 UI 레벨 제어
2. **API 게이트웨이**: CORS, Rate Limiting, Helmet 보안 헤더
3. **미들웨어**: JWT 검증 → 사용자 상태 확인 → 권한 검증
4. **서비스**: AWS Cognito 인증 + DynamoDB 권한 관리
5. **모델**: AWS 관리형 서비스로 데이터 보안

### 권한 검증 단계
```
1. authenticateToken: JWT 토큰 유효성 확인
2. requireApprovedUser: 승인된 사용자인지 확인  
3. requireAdmin: 관리자 권한 확인
```

### 에러 처리 패턴
```javascript
// 인증 실패
401 Unauthorized → 로그인 페이지 리다이렉트

// 권한 부족  
403 Forbidden → 접근 거부 메시지

// 승인 대기
403 Account Pending → 승인 대기 안내

// 계정 거부
403 Account Rejected → 거부 안내
```

