# 검사 항목 추가 가이드

새로운 검사 항목을 추가하는 방법을 단계별로 설명합니다.

## 1. 검사 항목 구조

```
backend/services/inspectors/
├── ec2/
│   ├── checks/
│   │   └── newItemChecker.js     # 새 검사 로직
│   └── index.js                  # Inspector 메인 파일
├── s3/
│   ├── checks/
│   │   └── newItemChecker.js     # 새 검사 로직
│   └── index.js                  # Inspector 메인 파일
└── iam/
    ├── checks/
    │   └── newItemChecker.js     # 새 검사 로직
    └── index.js                  # Inspector 메인 파일
```

## 2. 검사 로직 파일 생성

### 2.1 Checker 클래스 생성 (예: EC2)

```javascript
// backend/services/inspectors/ec2/checks/newItemChecker.js
const InspectionFinding = require('../../../../models/InspectionFinding');

class NewItemChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  async runAllChecks(resources) {
    for (const resource of resources) {
      await this.checkNewItem(resource);
    }
  }

  async checkNewItem(resource) {
    // 검사 로직 구현
    if (/* 문제 조건 */) {
      const finding = new InspectionFinding({
        resourceId: resource.ResourceId,
        resourceType: 'ResourceType',
        issue: '문제 설명',
        recommendation: '권장 사항'
      });
      this.inspector.addFinding(finding);
    }
  }
}

module.exports = NewItemChecker;
```

## 3. Inspector 메인 파일 수정

### 3.1 Checker Import 추가

```javascript
// backend/services/inspectors/ec2/index.js
const NewItemChecker = require('./checks/newItemChecker');

class EC2Inspector extends BaseInspector {
  constructor(options = {}) {
    super('EC2', options);
    
    this.checkers = {
      // 기존 checkers...
      newItem: new NewItemChecker(this)
    };
  }
```

### 3.2 지원 검사 유형 추가

```javascript
getSupportedInspectionTypes() {
  return [
    // 기존 항목들...
    'new-item'
  ];
}
```

### 3.3 개별 검사 메서드 추가

```javascript
// performItemInspection 메서드에 case 추가
async performItemInspection(awsCredentials, inspectionConfig) {
  const targetItem = inspectionConfig.targetItem;
  const results = {
    securityGroups: [],
    instances: [],
    findings: []
  };
  
  try {
    switch (targetItem) {
      // 기존 cases...
      case 'new-item':
        await this._inspectNewItem(results);
        break;
      
      default:
        // 알 수 없는 검사 항목에 대한 Finding 생성
        const finding = new InspectionFinding({
          resourceId: 'SYSTEM',
          resourceType: 'InspectionError',
          issue: `알 수 없는 검사 항목: ${targetItem}`,
          recommendation: '검사에 실패했습니다. 관리자에게 문의하세요.'
        });
        this.addFinding(finding);
        
        const error = new Error(`Unknown inspection item: ${targetItem}`);
        this.recordError(error, { targetItem });
        throw error;
    }
    
    this.updateProgress('분석 완료 중', 95);
    results.findings = this.findings;
    return results;
    
  } catch (error) {
    this.recordError(error, { targetItem });
    throw error;
  }
}

// 개별 검사 메서드 구현
async _inspectNewItem(results) {
  // 개별 검사를 위해 findings 초기화
  this.findings = [];
  
  this.updateProgress('리소스 조회 중', 20);
  const resources = await this.dataCollector.getSpecificResources(); // 실제 메서드명 사용
  results.resources = resources;
  this.incrementResourceCount(resources.length);
  
  this.updateProgress('새 항목 분석 중', 70);
  await this.checkers.newItem.runAllChecks(resources);
  
  results.findings = this.findings;
}
```

### 3.4 전체 검사에 추가

```javascript
async performInspection(awsCredentials, inspectionConfig) {
  // 기존 검사들...
  
  // 새 검사 추가
  this.updateProgress('새 항목 분석 중', 85);
  await this.checkers.newItem.runAllChecks(data.resources);
}
```

## 4. 데이터 수집기 확장 (필요시)

새로운 AWS 리소스 타입이 필요한 경우 데이터 수집기에 메서드를 추가합니다.

### 4.1 새로운 AWS API 호출 추가

```javascript
// backend/services/inspectors/ec2/collectors/ec2DataCollector.js
async getNewResources() {
  try {
    const command = new DescribeNewResourcesCommand({});
    const response = await this.inspector.retryableApiCall(
      () => this.ec2Client.send(command),
      'DescribeNewResources'
    );
    return response.Resources || [];
  } catch (error) {
    this.inspector.recordError(error, { operation: 'getNewResources' });
    return [];
  }
}
```

### 4.2 collectAllData 메서드 업데이트

새로운 리소스를 전체 데이터 수집에 포함시킵니다:

```javascript
// backend/services/inspectors/ec2/collectors/ec2DataCollector.js
async collectAllData() {
  const [securityGroups, instances, newResources] = await Promise.all([
    this.getSecurityGroups(),
    this.getEC2Instances(),
    this.getNewResources() // 새로 추가
  ]);

  return {
    securityGroups,
    instances,
    newResources // 새로 추가
  };
}
```

## 5. 프론트엔드 연동

### 5.1 검사 항목 정의 추가

```javascript
// frontend/src/data/inspectionItems.js
// 해당 서비스의 categories > items 배열에 추가
{
  id: 'new-item',
  name: '새 검사 항목',
  shortDescription: '간단한 설명',
  description: '상세한 설명',
  severity: 'CRITICAL', // 또는 'WARN'
  enabled: true
}
```

## 6. 체크리스트

- [ ] Checker 클래스 생성
- [ ] Inspector에 checker 등록
- [ ] 지원 검사 유형에 추가
- [ ] 개별 검사 메서드 구현
- [ ] 전체 검사에 통합
- [ ] 데이터 수집기 확장 (필요시)
- [ ] inspectionItems.js에 항목 정의 추가
- [ ] 프론트엔드 연동

## 7. 주의사항

1. **일관성 유지**: 기존 검사 항목과 동일한 패턴 사용
2. **findings 초기화**: 개별 검사 메서드에서 `this.findings = []` 필수
3. **에러 처리**: 모든 AWS API 호출에 에러 처리 추가
4. **리소스 카운트**: `incrementResourceCount()` 호출
5. **진행률 업데이트**: `updateProgress()` 호출
6. **Finding 형식**: InspectionFinding 모델 사용 (4개 필드: resourceId, resourceType, issue, recommendation)
7. **성능 고려**: 불필요한 API 호출 방지
8. **riskLevel 제거**: InspectionFinding에서 riskLevel 필드 제거됨 (프론트엔드에서 severity 결정)

## 8. 실제 데이터 수집기 메서드명

각 서비스별로 구체적인 메서드명을 사용하세요:

```javascript
// EC2
await this.dataCollector.getSecurityGroups();
await this.dataCollector.getEC2Instances();

// S3
await this.dataCollector.getBuckets();

// IAM
await this.dataCollector.getUsers();
await this.dataCollector.getRoles();
await this.dataCollector.getPolicies();
```

## 9. 예제: VPC 엔드포인트 검사 추가

```javascript
// 1. Checker 생성
class VpcEndpointChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  async runAllChecks(vpcs) {
    for (const vpc of vpcs) {
      await this.checkVpcEndpoints(vpc);
    }
  }

  async checkVpcEndpoints(vpc) {
    if (!vpc.VpcEndpoints || vpc.VpcEndpoints.length === 0) {
      const finding = new InspectionFinding({
        resourceId: vpc.VpcId,
        resourceType: 'VPC',
        issue: 'VPC 엔드포인트가 설정되지 않음',
        recommendation: 'S3, DynamoDB 등 주요 서비스에 VPC 엔드포인트 설정 권장'
      });
      this.inspector.addFinding(finding);
    }
  }
}

// 2. Inspector에 등록
this.checkers = {
  vpcEndpoint: new VpcEndpointChecker(this)
};

// 3. 검사 실행
await this.checkers.vpcEndpoint.runAllChecks(data.vpcs);
```