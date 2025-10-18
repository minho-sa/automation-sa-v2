# 새로운 Checker 추가 가이드

## 🎯 핵심 원칙

**각 Checker는 자신만의 도메인별 검증 로직을 구현해야 합니다.**

- 새로운 Checker 추가가 메인 목적
- 데이터 형식 검증은 서비스마다 다르므로 각 Checker에서 구현
- 검사 로직은 도메인별로 완전히 다르므로 분리 유지
- BaseInspector는 공통 플로우만 관리, 도메인 로직은 각자 구현
- 기존 패턴을 따라 일관성 유지

## 📁 Checker 구조 패턴

```
backend/services/inspectors/
├── baseInspector.js          # 공통 플로우 관리
├── index.js                  # Inspector 레지스트리
└── {service}/               # 서비스별 폴더
    ├── index.js             # ServiceInspector (메인)
    ├── collectors/
    │   └── {service}DataCollector.js
    └── checks/              # 개별 Checker들 (여기에 새로운 Checker 추가)
        ├── checker1.js
        ├── checker2.js
        └── newChecker.js    # 새로 추가할 Checker
```

**EC2 예시:**
```
ec2/
├── index.js
├── collectors/ec2DataCollector.js
└── checks/
    ├── securityGroupInspector.js
    ├── publicInstanceInspector.js
    └── newEC2Checker.js     # 새로 추가
```

## 🔧 필수 구현 사항

### 1. BaseInspector 상속
```javascript
class NewChecker extends BaseInspector {
  constructor() {
    super('SERVICE_TYPE'); // EC2, S3, IAM 등
    
    // 도메인별 상수 데이터 미리 준비 (성능 최적화)
    this.checkCriteria = {
      // 검사 기준 정의
    };
  }
}
```

**EC2 예시:**
```javascript
class SecurityGroupChecker extends BaseInspector {
  constructor() {
    super('EC2');
    this.dangerousPortsArray = [
      { port: 22, service: 'SSH' },
      { port: 3389, service: 'RDP' }
    ];
  }
}
```

**💡 BaseInspector가 자동으로 처리하는 것들:**
- 글로벌 서비스 vs 리전별 서비스 구분 (`isGlobalService()` 기반)
- 리전 설정 (글로벌 서비스는 'global', 리전별 서비스는 실제 리전)
- InspectionService 호환성 (`executeItemInspection()` 자동 변환)
- Finding 결과 변환 (`toApiResponse()` 자동 처리)
- 공통 에러 처리 및 로깅 (`recordError()`, `createLogger()`)
- 진행률 관리 (`incrementResourceCount()`, `updateProgress()`)

### 2. 필수 메서드 구현

#### performInspection() - 핵심 검사 로직
```javascript
async performInspection(awsCredentials, inspectionConfig) {
  try {
    // 1. AWS 클라이언트 초기화
    this.serviceClient = new ServiceClient({
      region: awsCredentials.region || 'us-east-1', // 글로벌 서비스는 생략
      credentials: {
        accessKeyId: awsCredentials.accessKeyId,
        secretAccessKey: awsCredentials.secretAccessKey,
        sessionToken: awsCredentials.sessionToken
      }
    });
    this.dataCollector = new ServiceDataCollector(this.serviceClient, this);

    // 2. 데이터 수집
    const collector = {
      collect: () => this.dataCollector.getYourResources()
    };
    const result = await this.collectAndValidate(collector, null);
    
    if (result.status === 'SUCCESS') {
      // 3. 형식 검증
      if (!Array.isArray(result.data)) {
        this.addFinding('resources', 'ResourceType', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      // 4. 실제 검사 수행
      await this.checkResources(result.data);
    } else if (result.status === 'ERROR') {
      this.handleAWSError(result.error);
      throw new Error(`수집 실패: ${result.reason}`);
    }
  } catch (error) {
    this.handleAWSError(error);
    throw error;
  }
}
```

**EC2 예시:**
```javascript
// EC2Client 초기화
this.ec2Client = new EC2Client({...});
this.dataCollector = new EC2DataCollector(this.ec2Client, this);

// 보안그룹 수집
const collector = { collect: () => this.dataCollector.getSecurityGroups() };
```

#### 도메인별 데이터 형식 검증 (필수)
```javascript
validateResourceFormat(resource) {
  if (!resource || typeof resource !== 'object') {
    return { valid: false, error: '리소스가 객체가 아님' };
  }
  
  // 필수 필드 검증
  const requiredFields = ['id', 'name']; // 실제 필드명으로 변경
  const missingFields = requiredFields.filter(field => !resource[field]);
  
  if (missingFields.length > 0) {
    return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
  }
  
  return { valid: true };
}
```

**EC2 보안그룹 예시:**
```javascript
validateSecurityGroupFormat(sg) {
  if (!sg || typeof sg !== 'object') {
    return { valid: false, error: '보안그룹이 객체가 아님' };
  }
  
  const missingFields = [];
  if (!sg.GroupId) missingFields.push('GroupId');
  if (!sg.GroupName) missingFields.push('GroupName');
  if (!sg.IpPermissions) missingFields.push('IpPermissions');
  
  if (missingFields.length > 0) {
    return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
  }
  
  return { valid: true };
}
```

#### 실제 검사 로직 구현 (핵심)
```javascript
async checkResources(resources) {
  let hasFormatError = false;
  const formatErrors = new Set();
  
  for (const resource of resources) {
    this.incrementResourceCount();
    
    // 형식 검증
    const validation = this.validateResourceFormat(resource);
    if (!validation.valid) {
      if (!hasFormatError) {
        formatErrors.add(validation.error);
        hasFormatError = true;
      }
      continue;
    }
    
    // 실제 검사 수행
    await this.performResourceCheck(resource);
  }
  
  // 형식 오류 한 번만 기록
  if (hasFormatError) {
    this.addFinding('format-error', 'System', 
      `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
      '데이터 구조 확인');
  }
}

async performResourceCheck(resource) {
  // 실제 검사 로직 구현
  if (/* 문제 조건 */) {
    this.addFinding(
      resource.id,
      'ResourceType',
      '발견된 문제 설명',
      '해결 방법 제시'
    );
  }
}
```

**EC2 보안그룹 예시:**
```javascript
async checkDangerousPorts(securityGroup) {
  const issues = [];
  for (const rule of securityGroup.IpPermissions) {
    const hasPublicAccess = rule.IpRanges?.some(range => range.CidrIp === '0.0.0.0/0');
    if (hasPublicAccess) {
      // 위험한 포트 검사 로직
      for (const { port, service } of this.dangerousPortsArray) {
        if (rule.FromPort <= port && port <= rule.ToPort) {
          issues.push(`${service} 포트(${port})`);
        }
      }
    }
  }
  
  if (issues.length > 0) {
    this.addFinding(securityGroup.GroupId, 'SecurityGroup', 
      `위험한 포트 개방: ${issues.join(', ')}`, '포트 접근 제한 필요');
  }
}
```

#### AWS 에러 처리 (필수)
```javascript
handleAWSError(error) {
  if (!error) return;
  
  switch (error.name) {
    case 'UnauthorizedOperation':
      this.addFinding('system', 'Permission', 'AWS 권한 부족', 'IAM 정책 확인');
      break;
    case 'ExpiredToken':
      this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
      break;
    default:
      this.recordError(error, { context: 'AWS API 호출' });
  }
}
```

**EC2 예시:**
```javascript
handleAWSError(error) {
  switch (error.name) {
    case 'UnauthorizedOperation':
      this.addFinding('security-groups', 'SecurityGroup', 
        'AWS 권한 부족: DescribeSecurityGroups 권한이 필요합니다', 
        'IAM 정책에 ec2:DescribeSecurityGroups 권한을 추가하세요');
      break;
    // ... 기타 EC2 특화 에러들
  }
}
```

### 3. DataCollector 사용 시 필수 메서드
```javascript
async retryableApiCall(apiCall, operationName, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## 🚀 새로운 Checker 추가 단계 (메인 가이드)

### 1단계: 새로운 Checker 클래스 생성
```javascript
// backend/services/inspectors/{SERVICE}/checks/newChecker.js
const BaseInspector = require('../../baseInspector');
const { ServiceClient } = require('@aws-sdk/client-{service}');
const ServiceDataCollector = require('../collectors/{service}DataCollector');

class NewChecker extends BaseInspector {
  constructor() {
    super('SERVICE_TYPE'); // EC2, S3, IAM 등
    
    // 검사 기준 정의 (성능 최적화)
    this.checkCriteria = {
      // 검사 기준 정의
    };
  }

  async performInspection(awsCredentials, inspectionConfig) {
    try {
      // 1. AWS 클라이언트 초기화
      this.serviceClient = new ServiceClient({
        region: awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });
      this.dataCollector = new ServiceDataCollector(this.serviceClient, this);

      // 2. 데이터 수집
      const collector = { collect: () => this.dataCollector.getYourResources() };
      const result = await this.collectAndValidate(collector, null);
      
      if (result.status === 'SUCCESS') {
        // 3. 형식 검증
        if (!Array.isArray(result.data)) {
          this.addFinding('resources', 'ResourceType', '데이터 형식 오류', '데이터 구조 확인');
          throw new Error('데이터 형식 오류');
        }
        
        // 4. 실제 검사 수행
        await this.checkResources(result.data);
      } else if (result.status === 'ERROR') {
        this.handleAWSError(result.error);
        throw new Error(`수집 실패: ${result.reason}`);
      }
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  // 도메인별 형식 검증 구현
  validateResourceFormat(resource) {
    // 각 도메인에 맞는 검증 로직 구현
    if (!resource || typeof resource !== 'object') {
      return { valid: false, error: '리소스가 객체가 아님' };
    }
    
    const requiredFields = ['id', 'name']; // 실제 필드명으로 변경
    const missingFields = requiredFields.filter(field => !resource[field]);
    
    if (missingFields.length > 0) {
      return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
    }
    
    return { valid: true };
  }

  // 실제 검사 로직 구현
  async checkResources(resources) {
    let hasFormatError = false;
    const formatErrors = new Set();
    
    for (const resource of resources) {
      this.incrementResourceCount();
      
      const validation = this.validateResourceFormat(resource);
      if (!validation.valid) {
        if (!hasFormatError) {
          formatErrors.add(validation.error);
          hasFormatError = true;
        }
        continue;
      }
      
      // 도메인별 핵심 검사 로직
      await this.performResourceCheck(resource);
    }
    
    if (hasFormatError) {
      this.addFinding('format-error', 'System', 
        `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
        '데이터 구조 확인');
    }
  }

  async performResourceCheck(resource) {
    // 실제 검사 로직 구현
    if (/* 문제 조건 */) {
      this.addFinding(
        resource.id,
        'ResourceType',
        '발견된 문제 설명',
        '해결 방법 제시'
      );
    }
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'UnauthorizedOperation':
        this.addFinding('system', 'Permission', 'AWS 권한 부족', 'IAM 정책 확인');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'AWS API 호출' });
    }
  }

  async retryableApiCall(apiCall, operationName, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

module.exports = NewChecker;
```

### 2단계: 서비스 Inspector에 Checker 등록
```javascript
// backend/services/inspectors/{service}/index.js에 추가
const NewChecker = require('./checks/newChecker');

class ServiceInspector extends BaseInspector {
  constructor() {
    super('SERVICE_TYPE'); // EC2, S3, IAM 등
    this.checkers = {
      // 기존 checkers...
      'new-check-item': NewChecker  // 새로운 checker 추가
    };
  }
}
```

**서비스별 예시:**
- **EC2**: `backend/services/inspectors/ec2/index.js`
- **S3**: `backend/services/inspectors/s3/index.js`
- **IAM**: `backend/services/inspectors/iam/index.js` (새로 생성 시)

### 3단계: 프론트엔드 검사항목 정의
```javascript
// frontend/src/data/inspectionItems.js에 추가
{
  id: 'new-check-item', // 서비스Inspector의 checkers 키와 정확히 일치
  name: '새로운 검사항목',
  shortDescription: '실제 검사하는 구체적인 내용과 방법을 상세히 설명',
  severity: 'CRITICAL', // 또는 'WARN'
  enabled: true
}
```

**서비스별 섹션에 추가:**
- **EC2 검사항목**: `EC2_INSPECTION_ITEMS` 배열
- **S3 검사항목**: `S3_INSPECTION_ITEMS` 배열
- **IAM 검사항목**: `IAM_INSPECTION_ITEMS` 배열 (새로 생성 시)

### 4단계: 검증 및 테스트
```bash
# 백엔드 서버 재시작
cd backend && npm run dev

# 프론트엔드에서 새로운 검사항목 확인
# 해당 서비스 검사 시 새로운 항목이 목록에 나타나는지 확인
```

## 🔍 Checker 구현 패턴

### 일반적인 패턴
1. **데이터 형식 검증** - 필수 필드 존재 여부 확인
2. **비즈니스 로직** - 실제 보안/최적화 검사
3. **에러 처리** - AWS API 에러 대응

### EC2 보안그룹 Checker 예시 (참고용)
```javascript
class SecurityGroupChecker extends BaseInspector {
  constructor() {
    super('EC2');
    this.dangerousPortsArray = [
      { port: 22, service: 'SSH' },
      { port: 3389, service: 'RDP' }
    ];
  }

  async performInspection(awsCredentials, inspectionConfig) {
    // AWS 클라이언트 초기화
    this.ec2Client = new EC2Client({...});
    this.dataCollector = new EC2DataCollector(this.ec2Client, this);

    // 보안그룹 수집
    const collector = { collect: () => this.dataCollector.getSecurityGroups() };
    const result = await this.collectAndValidate(collector, null);
    
    if (result.status === 'SUCCESS') {
      await this.checkSecurityGroups(result.data);
    }
  }

  async checkSecurityGroups(securityGroups) {
    for (const sg of securityGroups) {
      this.incrementResourceCount();
      
      // 형식 검증
      const validation = this.validateSecurityGroupFormat(sg);
      if (!validation.valid) continue;
      
      // 위험한 포트 검사
      await this.checkDangerousPorts(sg);
    }
  }
}
```

## 📋 필수 체크리스트

### 구현 완료 후 반드시 확인
- [ ] BaseInspector 상속 확인
- [ ] 도메인별 데이터 형식 검증 로직 구현
- [ ] 실제 검사 로직 구현 (핵심 비즈니스 로직)
- [ ] AWS 에러 처리 구현 (`handleAWSError()` 메서드)
- [ ] `this.addFinding()` 호출 확인
- [ ] `this.incrementResourceCount()` 호출 확인
- [ ] `retryableApiCall()` 메서드 구현 (DataCollector 사용 시)
- [ ] 해당 서비스Inspector의 checkers 객체에 등록 확인
- [ ] 프론트엔드 검사항목 ID와 checkers 키 일치 확인
- [ ] 실제 검사 동작 테스트 완료

### 성능 최적화 확인
- [ ] 상수 데이터 constructor에서 미리 준비
- [ ] 불필요한 검사 조기 종료 (early return)
- [ ] 형식 오류 중복 기록 방지
- [ ] API 재시도 로직 구현

## 🚫 금지사항

- ❌ `executeItemInspection()` 오버라이드 (BaseInspector가 자동 처리)
- ❌ 다른 도메인의 검증 로직 재사용
- ❌ BaseInspector에 도메인별 로직 추가
- ❌ 형식 검증 로직 공통화 시도
- ❌ inspectors/index.js에 직접 등록 (각 서비스별 index.js 사용)
- ❌ AWS 클라이언트 초기화 방식 변경 (기존 패턴 유지)

## ✅ 권장사항

- ✅ 각 Checker는 자신의 도메인 검증 로직만 구현
- ✅ 데이터 형식 검증은 도메인별로 완전히 분리
- ✅ 검사 로직은 비즈니스 요구사항에 맞게 구현
- ✅ 에러 처리는 도메인별 특성 반영 (`handleAWSError()` 구현)
- ✅ 성능 최적화는 도메인 특성에 맞게 적용 (상수 데이터 미리 준비)
- ✅ BaseInspector의 자동 처리 기능 신뢰하고 활용
- ✅ 기존 Checker들의 패턴을 참고하여 일관성 유지
- ✅ 실제 AWS API 응답 구조에 맞는 형식 검증 구현

## 📚 참고할 수 있는 기존 Checker들

### EC2 Checkers (예시로 참고)
- `securityGroupInspector.js` - 보안그룹 위험 포트 검사
- `publicInstanceInspector.js` - 퍼블릭 인스턴스 검사
- `stoppedInstanceInspector.js` - 중지된 인스턴스 검사
- `backupStatusInspector.js` - 백업 상태 검사
- `reservedInstanceInspector.js` - 예약 인스턴스 최적화 검사
- `instanceTypeOptimizationInspector.js` - 인스턴스 타입 최적화 검사
- `windowsServerEolInspector.js` - Windows Server EOL 검사

### S3 Checkers
- `publicAccessInspector.js` - S3 버킷 퍼블릭 액세스 검사

### 새로운 서비스 전체 추가 시
1. `backend/services/inspectors/{service}/` 폴더 생성
2. `index.js`, `collectors/`, `checks/` 구조 생성
3. `backend/services/inspectors/index.js`에 서비스 등록
4. 프론트엔드에 해당 서비스 검사항목 추가

**💡 팁: 구현하려는 검사와 가장 유사한 로직을 가진 기존 Checker를 참고하세요.**