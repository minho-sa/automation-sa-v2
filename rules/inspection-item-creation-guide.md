# Checker 설계 원칙

## 핵심 설계 철학

**각 Inspector는 자신의 도메인에 특화된 검증과 검사를 수행한다.**

- 데이터 형식은 서비스마다 다르므로 각 Inspector에서 처리
- 검사 로직은 도메인별로 완전히 다르므로 분리 유지
- 과도한 추상화보다는 실용적 설계 우선

## 1. Inspector 구조

```
backend/services/inspectors/
├── baseInspector.js          # 공통 플로우만 관리
├── ec2/
│   ├── index.js             # EC2Inspector
│   └── checks/
│       └── securityGroupInspector.js
└── s3/
    ├── index.js             # S3Inspector  
    └── checks/
        └── bucketInspector.js
```

## 2. 필수 구현 사항

### 2.1 BaseInspector 상속

```javascript
class SecurityGroupInspector extends BaseInspector {
  constructor() {
    super('EC2'); // 서비스 타입 지정
  }
}
```

### 2.2 필수 메서드 구현

```javascript
// 1. 실제 검사 로직
async performInspection(awsCredentials, inspectionConfig) {
  // AWS 클라이언트 초기화
  // 데이터 수집
  // 검사 수행
}

// 2. InspectionService 호환
async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
  const findings = await this.executeInspection(awsCredentials, inspectionConfig);
  return [{
    serviceType: this.serviceType,
    itemId: inspectionConfig.targetItem || 'default',
    findings: findings,
    inspectionTime: Date.now(),
    resourcesScanned: this.resourcesScanned
  }];
}
```

## 3. 데이터 수집 및 검증 패턴

### 3.1 직접 데이터 수집 (권장)

```javascript
// 직접 데이터 수집 방식 (단순하고 안정적)
const instances = await this.dataCollector.getEC2Instances();
const snapshots = await this.dataCollector.getSnapshots();

if (!Array.isArray(instances)) {
  this.addFinding('instances', 'EC2Instance', '데이터 형식 오류', '데이터 구조 확인');
  throw new Error('데이터 형식 오류');
}

await this.checkResources(instances, snapshots);
```

### 3.2 collectAndValidate 활용 (선택적)

```javascript
const collector = {
  collect: () => this.dataCollector.getSecurityGroups()
};

const result = await this.collectAndValidate(collector, null);

if (result.status === 'SUCCESS') {
  if (!Array.isArray(result.data)) {
    this.addFinding('resource-id', 'ResourceType', '형식 오류', '권장사항');
    throw new Error('데이터 형식 오류');
  }
  await this.checkResources(result.data);
} else if (result.status === 'ERROR') {
  this.handleAWSError(result.error);
  throw new Error(`수집 실패: ${result.reason}`);
}
```

### 3.3 도메인별 형식 검증

```javascript
// 각 Inspector마다 자신의 데이터 형식 검증
validateSecurityGroupFormat(sg) {
  if (!sg.GroupId) return { valid: false, error: 'GroupId 누락' };
  if (!sg.IpPermissions) return { valid: false, error: 'IpPermissions 누락' };
  if (!Array.isArray(sg.IpPermissions)) return { valid: false, error: 'IpPermissions가 배열이 아님' };
  return { valid: true };
}
```

## 4. 에러 처리 패턴

### 4.1 AWS 에러 처리

```javascript
handleAWSError(error) {
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

### 4.2 형식 오류 처리

```javascript
// 형식 오류는 한 번만 기록
let hasFormatError = false;
const formatErrors = new Set();

for (const resource of resources) {
  const validation = this.validateResourceFormat(resource);
  if (!validation.valid) {
    if (!hasFormatError) {
      formatErrors.add(validation.error);
      hasFormatError = true;
    }
    continue;
  }
  // 실제 검사 수행
}

if (hasFormatError) {
  this.addFinding('format-error', 'System', 
    `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
    '데이터 구조 확인');
}
```

## 5. 성능 최적화 고려사항

### 5.1 상수 데이터 미리 변환

```javascript
constructor() {
  super('EC2');
  // 성능 최적화: 반복 사용되는 데이터 미리 변환
  this.dangerousPortsArray = [
    { port: 22, service: 'SSH' },
    { port: 3389, service: 'RDP' }
  ];
}
```

### 5.2 불필요한 검사 건너뛰기

```javascript
if (!securityGroup.IpPermissions?.length) return;
if (fromPort === undefined || toPort === undefined) continue;
```

## 6. 필수 호출 메서드

```javascript
// 리소스 카운트 증가
this.incrementResourceCount();

// Finding 추가
this.addFinding(resourceId, resourceType, issue, recommendation);

// 에러 기록
this.recordError(error, context);

// 알려지지 않은 검사 항목 처리
this.handleUnknownInspectionItem(itemType);

// 수집 실패 처리
this.handleCollectionFailure(validation, targetId, resourceType);

// API 재시도 호출 (DataCollector 사용 시 필수)
this.retryableApiCall(apiCall, operationName, maxRetries);
```

## 7. 개별 항목 검사 지원

```javascript
// EC2Inspector에서 개별 항목 검사 처리 예시
async performItemInspection(awsCredentials, inspectionConfig) {
  const targetItem = inspectionConfig.targetItem || inspectionConfig.targetItemId;
  
  if (targetItem === 'all') {
    return await this.performInspection(awsCredentials, inspectionConfig);
  }
  
  if (targetItem === 'security-groups') {
    const sgInspector = new SecurityGroupInspector();
    await sgInspector.executeInspection(awsCredentials, inspectionConfig);
    this.findings.push(...sgInspector.findings);
    this.incrementResourceCount(sgInspector.resourcesScanned);
    return;
  }
  
  this.handleUnknownInspectionItem(targetItem);
}
```

## 8. 새로운 검사항목 추가 시 필수 작업

### 8.1 Frontend 검사항목 정의 업데이트

새로운 검사항목을 추가할 때는 반드시 `frontend/src/data/inspectionItems.js` 파일의 검사 내용도 함께 수정해야 합니다.

```javascript
// inspectionItems.js에서 새 검사항목 추가 예시
{
  id: 'new-inspection-item',
  name: '새로운 검사항목 이름',
  shortDescription: '실제 검사하는 구체적인 내용과 방법을 상세히 설명',
  severity: 'CRITICAL', // 또는 'WARN'
  enabled: true
}
```

**shortDescription 작성 가이드:**
- 백엔드 Inspector가 실제로 수행하는 검사 내용을 구체적으로 설명
- 검사 대상, 검사 방법, 판단 기준을 명확히 포함
- 사용자가 검사 항목만 보고도 정확히 무엇을 검사하는지 이해할 수 있도록 작성
- 예시: "보안그룹의 인바운드 규칙에서 SSH(22), RDP(3389) 등 6개 위험 포트가 인터넷(0.0.0.0/0)에 개방되어 있는지 검사. 단일 포트뿐만 아니라 포트 범위 내 위험한 포트 포함 여부도 탐지"

**주의사항:**
- Inspector의 검사항목 ID와 inspectionItems.js의 item.id가 정확히 일치해야 함
- severity는 검사 결과의 심각도를 결정하므로 신중히 설정
- shortDescription은 백엔드 검사 로직과 정확히 일치해야 함

## 8.2 새로운 검사항목 추가 템플릿

```javascript
const BaseInspector = require('../../baseInspector');
const { ServiceClient } = require('@aws-sdk/client-service');
const ServiceDataCollector = require('../collectors/serviceDataCollector');

class NewInspector extends BaseInspector {
  constructor() {
    super('SERVICE_TYPE'); // EC2, S3, IAM 등
  }

  // DataCollector 사용 시 필수 메서드
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

      // 2. 직접 데이터 수집 (권장)
      const resources = await this.dataCollector.getResources();
      
      if (!Array.isArray(resources)) {
        this.addFinding('resources', 'ResourceType', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      await this.checkResources(resources);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'default',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

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
      
      await this.performResourceCheck(resource);
    }
    
    if (hasFormatError) {
      this.addFinding('format-error', 'System', 
        `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
        '데이터 구조 확인');
    }
  }

  validateResourceFormat(resource) {
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

  async performResourceCheck(resource) {
    // 실제 검사 로직 구현
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
}

module.exports = NewInspector;
```

## 9. 체크리스트

### 백엔드 Inspector 구현
- [ ] BaseInspector 상속
- [ ] performInspection 구현
- [ ] executeItemInspection 구현
- [ ] retryableApiCall 구현 (DataCollector 사용 시)
- [ ] 직접 데이터 수집 또는 collectAndValidate 활용
- [ ] 도메인별 형식 검증 구현
- [ ] AWS 에러 처리 구현
- [ ] 성능 최적화 적용
- [ ] 필수 메서드 호출 확인

### 프론트엔드 검사항목 정의
- [ ] inspectionItems.js에 검사항목 추가
- [ ] shortDescription에 실제 검사 내용 구체적으로 작성
- [ ] 백엔드 검사 로직과 설명 내용 일치 확인
- [ ] severity 적절히 설정 (CRITICAL/WARN)

## 9. 금지사항

- ❌ 과도한 추상화 (Generic Validator, Generic Checker)
- ❌ 다른 도메인 로직 재사용 시도
- ❌ BaseInspector에 도메인별 로직 추가
- ❌ 형식 검증 로직 공통화 시도

## 10. 권장사항

- ✅ 각 Inspector는 자신의 도메인에만 집중
- ✅ 데이터 형식 검증은 각자 구현
- ✅ 검사 로직은 도메인별로 완전 분리
- ✅ BaseInspector는 공통 플로우만 관리
- ✅ 실용적 설계 우선, 이론적 완벽함 지양