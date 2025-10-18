# Inspector 생성 가이드

## 🎯 핵심 원칙

**각 Inspector는 자신만의 도메인별 검증 로직을 구현해야 합니다.**

- 데이터 형식 검증은 서비스마다 다르므로 각 Inspector에서 구현
- 검사 로직은 도메인별로 완전히 다르므로 분리 유지
- BaseInspector는 공통 플로우만 관리, 도메인 로직은 각자 구현

## 📁 Inspector 구조

```
backend/services/inspectors/
├── baseInspector.js          # 공통 플로우만 관리
├── ec2/
│   ├── index.js             # EC2Inspector (메인)
│   ├── collectors/
│   │   └── ec2DataCollector.js
│   └── checks/
│       └── securityGroupInspector.js  # 개별 검사 로직
└── s3/
    ├── index.js             # S3Inspector
    └── checks/
        └── publicAccessInspector.js
```

## 🔧 필수 구현 사항

### 1. BaseInspector 상속
```javascript
class SecurityGroupInspector extends BaseInspector {
  constructor() {
    super('EC2'); // 서비스 타입만 지정하면 됨
    
    // 도메인별 상수 데이터 미리 준비 (성능 최적화)
    this.dangerousPortsArray = [
      { port: 22, service: 'SSH' },
      { port: 3389, service: 'RDP' },
      { port: 23, service: 'Telnet' }
    ];
  }
}
```

**💡 BaseInspector가 자동으로 처리하는 것들:**
- 글로벌 서비스 vs 리전별 서비스 구분 (`isGlobalService()` 기반)
- 리전 설정 (글로벌 서비스는 'global', 리전별 서비스는 실제 리전)
- InspectionService 호환성 (`executeItemInspection()` 자동 변환)
- Finding 결과 변환 (`toApiResponse()` 자동 처리)

### 2. 필수 메서드 구현

#### performInspection() - 핵심 검사 로직
```javascript
async performInspection(awsCredentials, inspectionConfig) {
  try {
    // 1. AWS 클라이언트 초기화 (this.region은 BaseInspector가 자동 설정)
    this.ec2Client = new EC2Client({
      region: this.region, // BaseInspector가 글로벌/리전별 서비스 구분하여 설정
      credentials: awsCredentials
    });
    this.dataCollector = new EC2DataCollector(this.ec2Client, this);

    // 2. 데이터 수집 및 검증
    const result = await this.collectAndValidate({
      collect: () => this.dataCollector.getSecurityGroups()
    }, null);
    
    if (result.status === 'SUCCESS') {
      // 3. 도메인별 형식 검증
      if (!Array.isArray(result.data)) {
        this.addFinding('security-groups', 'SecurityGroup', 
          '보안그룹 데이터 형식 오류: 배열이 아님', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      // 4. 실제 검사 수행
      await this.checkSecurityGroups(result.data);
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

#### 도메인별 데이터 형식 검증 (필수)
```javascript
validateSecurityGroupFormat(sg) {
  const missingFields = [];
  
  if (!sg || typeof sg !== 'object') {
    return { valid: false, error: '보안그룹이 객체가 아님' };
  }
  
  // 도메인별 필수 필드 검증
  if (!sg.GroupId) missingFields.push('GroupId');
  if (!sg.GroupName) missingFields.push('GroupName');
  if (!sg.IpPermissions) missingFields.push('IpPermissions');
  
  if (missingFields.length > 0) {
    return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
  }
  
  if (!Array.isArray(sg.IpPermissions)) {
    return { valid: false, error: 'IpPermissions가 배열이 아님' };
  }
  
  // 중첩 구조 검증
  for (let i = 0; i < sg.IpPermissions.length; i++) {
    const ruleValidation = this.validateRuleFormat(sg.IpPermissions[i]);
    if (!ruleValidation.valid) {
      return { valid: false, error: `규칙 ${i}: ${ruleValidation.error}` };
    }
  }
  
  return { valid: true };
}

validateRuleFormat(rule) {
  if (!rule || typeof rule !== 'object') {
    return { valid: false, error: '규칙이 객체가 아님' };
  }
  
  // IpRanges 검증
  if (rule.IpRanges && !Array.isArray(rule.IpRanges)) {
    return { valid: false, error: 'IpRanges가 배열이 아님' };
  }
  
  if (rule.IpRanges) {
    for (let i = 0; i < rule.IpRanges.length; i++) {
      const range = rule.IpRanges[i];
      if (!range || typeof range !== 'object') {
        return { valid: false, error: `IpRanges[${i}]가 객체가 아님` };
      }
      if (!range.hasOwnProperty('CidrIp')) {
        return { valid: false, error: `IpRanges[${i}]에 CidrIp 필드 누락` };
      }
    }
  }
  
  return { valid: true };
}
```

#### 실제 검사 로직 구현 (도메인별 핵심)
```javascript
async checkSecurityGroups(securityGroups) {
  let hasFormatError = false;
  const formatErrors = new Set();
  
  for (const sg of securityGroups) {
    this.incrementResourceCount();
    
    // 각 리소스별 형식 검증
    const validation = this.validateSecurityGroupFormat(sg);
    if (!validation.valid) {
      if (!hasFormatError) {
        formatErrors.add(validation.error);
        hasFormatError = true;
      }
      continue; // 형식 오류 시 검사 건너뛰기
    }
    
    // 실제 보안 검사 수행
    await this.checkDangerousPorts(sg);
  }
  
  // 형식 오류 한 번만 기록
  if (hasFormatError) {
    this.addFinding('security-groups-format', 'SecurityGroup', 
      `보안그룹 데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
      '보안그룹 데이터 구조 확인');
  }
}

// 도메인별 핵심 검사 로직
async checkDangerousPorts(securityGroup) {
  if (!securityGroup.IpPermissions?.length) return;

  const issues = [];

  for (const rule of securityGroup.IpPermissions) {
    const hasPublicAccess = rule.IpRanges?.some(range => range.CidrIp === '0.0.0.0/0');
    if (!hasPublicAccess) continue;
    
    const fromPort = rule.FromPort;
    const toPort = rule.ToPort;
    if (fromPort === undefined || toPort === undefined) continue;

    // 도메인별 검사 로직 - 위험한 포트 검사
    for (const { port, service } of this.dangerousPortsArray) {
      if (fromPort === toPort) {
        // 단일 포트 검사
        if (port === fromPort) {
          issues.push(`${service} 포트(${port})`);
        }
      } else {
        // 포트 범위 검사
        if (port >= fromPort && port <= toPort) {
          issues.push(`${service} 포트(${port}) 포함 범위(${fromPort}-${toPort})`);
          break;
        }
      }
    }
  }

  if (issues.length > 0) {
    this.addFinding(
      securityGroup.GroupId,
      'SecurityGroup',
      `보안그룹 '${securityGroup.GroupName}'에서 위험한 포트가 인터넷에 개방됨: ${issues.join(', ')}`,
      '위험한 포트들을 특정 IP로 제한하거나 제거하세요.'
    );
  }
}
```

#### AWS 에러 처리 (도메인별)
```javascript
handleAWSError(error) {
  if (!error) return;
  
  switch (error.name) {
    case 'UnauthorizedOperation':
      this.addFinding('security-groups', 'SecurityGroup', 
        'AWS 권한 부족: DescribeSecurityGroups 권한이 필요합니다', 
        'IAM 정책에 ec2:DescribeSecurityGroups 권한을 추가하세요');
      break;
    case 'InvalidUserID.NotFound':
      this.addFinding('security-groups', 'SecurityGroup', 
        'AWS 계정 정보를 찾을 수 없습니다', 
        'AWS 계정 ID와 역할 ARN을 확인하세요');
      break;
    case 'ExpiredToken':
      this.addFinding('security-groups', 'SecurityGroup', 
        'AWS 인증 토큰이 만료되었습니다', 
        'AWS 자격 증명을 갱신하세요');
      break;
    default:
      this.recordError(error, { context: 'AWS API 호출' });
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

## 🚀 새로운 Inspector 구현 단계

### 1단계: Inspector 클래스 생성
```javascript
// backend/services/inspectors/ec2/checks/newInspector.js
const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class NewInspector extends BaseInspector {
  constructor() {
    super('EC2');
    
    // 도메인별 상수 데이터 준비
    this.checkCriteria = {
      // 검사 기준 정의
    };
  }

  async performInspection(awsCredentials, inspectionConfig) {
    try {
      // 1. AWS 클라이언트 초기화 (this.region은 BaseInspector가 자동 설정)
      this.ec2Client = new EC2Client({
        region: this.region, // BaseInspector가 글로벌/리전별 서비스 구분하여 설정
        credentials: awsCredentials
      });
      this.dataCollector = new EC2DataCollector(this.ec2Client, this);

      // 2. 데이터 수집
      const result = await this.collectAndValidate({
        collect: () => this.dataCollector.getYourResources()
      }, null);
      
      if (result.status === 'SUCCESS') {
        // 3. 도메인별 형식 검증
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

module.exports = NewInspector;
```

### 2단계: Inspector 등록
```javascript
// backend/services/inspectors/index.js에 추가
const NewInspector = require('./ec2/checks/newInspector');

// initializeRegistry() 메서드에 추가
this.register('EC2', NewInspector);
```

### 3단계: 프론트엔드 검사항목 정의
```javascript
// frontend/src/data/inspectionItems.js에 추가
{
  id: 'new-inspection-item', // 백엔드 targetItem과 정확히 일치
  name: '새로운 검사항목',
  shortDescription: '실제 검사하는 구체적인 내용과 방법을 상세히 설명',
  severity: 'CRITICAL', // 또는 'WARN'
  enabled: true
}
```

## 🔍 도메인별 검증 로직 예시

### EC2 보안그룹 검사 (실제 구현)
- **데이터 형식 검증:** GroupId, GroupName, IpPermissions 필수 필드 확인
- **중첩 구조 검증:** IpPermissions 배열 내 각 규칙의 IpRanges 검증
- **비즈니스 로직:** 위험한 포트(SSH, RDP 등)의 인터넷 개방 여부 검사

### S3 버킷 검사 예시
- **데이터 형식 검증:** Name 필드 존재 여부 확인
- **비즈니스 로직:** 퍼블릭 액세스 차단 설정 4가지 옵션 검사
- **참고:** S3는 글로벌 서비스이지만 BaseInspector가 자동으로 처리

### IAM 정책 검사 예시
- **데이터 형식 검증:** PolicyDocument JSON 파싱 가능 여부 확인
- **중첩 구조 검증:** Statement 배열 내 각 정책의 Action, Resource 검증
- **비즈니스 로직:** 과도한 권한(*, Admin 권한) 부여 여부 검사
- **참고:** IAM은 글로벌 서비스이지만 BaseInspector가 자동으로 처리

## 📋 필수 체크리스트

### 구현 완료 후 반드시 확인
- [ ] BaseInspector 상속 확인
- [ ] 도메인별 데이터 형식 검증 로직 구현
- [ ] 실제 검사 로직 구현 (핵심 비즈니스 로직)
- [ ] AWS 에러 처리 구현
- [ ] `this.addFinding()` 호출 확인
- [ ] `this.incrementResourceCount()` 호출 확인
- [ ] inspectors/index.js 등록 확인
- [ ] 프론트엔드 검사항목 ID 일치 확인

### 성능 최적화 확인
- [ ] 상수 데이터 constructor에서 미리 준비
- [ ] 불필요한 검사 조기 종료 (early return)
- [ ] 형식 오류 중복 기록 방지
- [ ] API 재시도 로직 구현

## 🚫 금지사항

- ❌ executeItemInspection() 오버라이드 (BaseInspector가 자동 처리)
- ❌ 리전 처리 로직 직접 구현 (BaseInspector가 자동 처리)
- ❌ 다른 도메인의 검증 로직 재사용
- ❌ BaseInspector에 도메인별 로직 추가
- ❌ 형식 검증 로직 공통화 시도

## ✅ 권장사항

- ✅ 각 Inspector는 자신의 도메인 검증 로직만 구현
- ✅ 데이터 형식 검증은 도메인별로 완전히 분리
- ✅ 검사 로직은 비즈니스 요구사항에 맞게 구현
- ✅ 에러 처리는 도메인별 특성 반영
- ✅ 성능 최적화는 도메인 특성에 맞게 적용
- ✅ BaseInspector의 자동 처리 기능 신뢰하고 활용