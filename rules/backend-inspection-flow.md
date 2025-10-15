# 백엔드 검사 로직 흐름 (Backend Inspection Flow)

## 전체 아키텍처 개요

백엔드의 검사 시스템은 다음과 같은 계층 구조로 구성됩니다:

```
프론트엔드 요청
    ↓
Controller
    ↓
InspectionService (최상위 컨트롤러)
    ↓
Inspector (서비스별 검사 오케스트레이션)
    ↓
Checker (실제 검사 로직)
    ↓
InspectionItemService (결과 저장)
```

## 상세 흐름

### 1. 검사 요청 처리

**프론트엔드 → Controller → InspectionService**
- 프론트엔드에서 검사할 항목들의 리스트를 `selectedItems` 배열로 전송
- Controller가 요청을 받아 `InspectionService.startInspection()` 호출

### 2. InspectionService의 역할

**InspectionService는 전체 검사 흐름의 최상위 컨트롤러**

```javascript
// InspectionService.js - startInspection()
async startInspection(customerId, serviceType, assumeRoleArn, inspectionConfig) {
  // 1. 각 검사 항목별로 작업 생성
  for (const itemId of selectedItems) {
    const inspectionId = uuidv4();
    inspectionJobs.push({ inspectionId, itemId });
  }
  
  // 2. 각 항목별로 비동기 검사 실행
  const executionPromises = inspectionJobs.map(job => {
    return this.executeItemInspectionAsync(customerId, job.inspectionId, serviceType, assumeRoleArn, {
      targetItemId: job.itemId
    });
  });
}
```

### 3. 개별 항목 검사 실행

**InspectionService → Inspector**

```javascript
// InspectionService.js - executeItemInspectionAsync()
async executeItemInspectionAsync(customerId, inspectionId, serviceType, assumeRoleArn, inspectionConfig) {
  // 1. Inspector 가져오기
  inspector = inspectorRegistry.getInspector(serviceType);
  
  // 2. Inspector로 검사 수행 (저장은 하지 않음)
  const itemResults = await inspector.executeItemInspection(
    customerId, inspectionId, awsCredentials, inspectionConfig
  );
  
  // 3. InspectionService에서 저장 처리
  await this.saveInspectionItemResults(itemResults, { customerId, inspectionId });
}
```

### 4. Inspector의 역할

**Inspector는 검사 오케스트레이션만 담당**

```javascript
// BaseInspector.js - executeItemInspection()
async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
  // 1. 검사 초기화
  this.findings = [];
  
  // 2. 개별 항목 검사 수행 (하위 클래스에서 구현)
  const results = await this.performItemInspection(awsCredentials, inspectionConfig);
  
  // 3. 검사 항목 결과 생성
  const itemResults = this.buildItemResults(inspectionConfig);
  
  return itemResults; // InspectionService로 반환
}
```

### 5. 실제 검사 로직 (Checker)

**Inspector → Checker (직접 호출 방식)**

```javascript
// EC2Inspector.js - _inspectDangerousPorts()
async _inspectDangerousPorts(results) {
  // 1. 데이터 수집
  const securityGroups = await this.dataCollector.getSecurityGroups();
  
  // 2. Checker 실행
  await this.checkers.dangerousPorts.runAllChecks(securityGroups);
  
  // 3. 결과는 this.findings에 자동 수집됨 (Checker가 직접 addFinding 호출)
}

// DangerousPortsChecker.js
async runAllChecks(securityGroups) {
  for (const securityGroup of securityGroups) {
    // 실제 검사 로직 수행
    const finding = new InspectionFinding({...});
    
    // Inspector에 Finding 직접 추가 (반환하지 않음)
    this.inspector.addFinding(finding);
  }
}

// BaseInspector.js
addFinding(finding) {
  this.findings.push(finding); // Inspector의 findings 배열에 직접 저장
}
```

### 6. 결과 저장

**InspectionService → InspectionItemService**

```javascript
// InspectionService.js - saveInspectionItemResults()
async saveInspectionItemResults(itemResults, metadata) {
  const inspectionItemService = require('./inspectionItemService');
  
  for (const itemResult of itemResults) {
    await inspectionItemService.saveItemResult(
      metadata.customerId, 
      metadata.inspectionId, 
      itemResult
    );
  }
}
```

## 핵심 원칙

### 1. 관심사 분리 (Separation of Concerns)
- **InspectionService**: 전체 흐름 관리 및 저장
- **Inspector**: 검사 오케스트레이션 및 결과 수집
- **Checker**: 순수한 검사 로직만
- **InspectionItemService**: 데이터 저장 전담

### 2. 데이터 흐름
- **Checker는 저장을 직접 하지 않음** - Finding 객체 생성 후 `inspector.addFinding()` 직접 호출
- **Inspector가 중간 역할** - Checker들이 직접 추가한 Finding들을 `this.findings`에 수집
- **InspectionService가 저장 담당** - Inspector로부터 받은 결과를 저장

### 3. 병렬 처리
- 각 검사 항목마다 별도의 `inspectionId` 생성
- 모든 항목이 동시에 검사 시작 (`Promise.all`)
- 개별 저장으로 부분 실패 허용

## 파일 구조

```
backend/
├── services/
│   ├── inspectionService.js          # 최상위 컨트롤러
│   ├── inspectionItemService.js      # 저장 전담
│   └── inspectors/
│       ├── baseInspector.js          # Inspector 기본 클래스
│       ├── ec2/
│       │   ├── index.js              # EC2Inspector
│       │   └── checks/               # 실제 검사 로직들
│       │       ├── dangerousPortsChecker.js
│       │       ├── ebsEncryptionChecker.js
│       │       └── ...
│       ├── s3/
│       │   ├── index.js              # S3Inspector
│       │   └── checks/
│       └── iam/
│           ├── index.js              # IAMInspector
│           └── checks/
```

## 예시: EC2 Dangerous Ports 검사

1. **프론트엔드**: `selectedItems: ['dangerous-ports']` 전송
2. **InspectionService**: `dangerous-ports` 항목에 대한 검사 작업 생성
3. **EC2Inspector**: `_inspectDangerousPorts()` 메서드 실행
4. **DangerousPortsChecker**: 보안 그룹 분석 후 Finding 생성
5. **EC2Inspector**: `this.findings`에 결과 수집 후 반환
6. **InspectionService**: 결과를 InspectionItemService로 저장

이 구조를 통해 각 컴포넌트의 책임이 명확히 분리되고, 확장성과 유지보수성이 보장됩니다.
## Fi
nding 데이터 흐름 상세

### 정확한 Finding 전달 방식

```
InspectionService 
    ↓ (검사 요청)
Inspector (this.findings = [])
    ↓ (Checker 실행)
Checker 
    ↓ (Finding 생성 후 직접 호출)
Inspector.addFinding(finding) ← 직접 호출
    ↓ (this.findings.push(finding))
Inspector (Finding 수집 완료)
    ↓ (buildItemResults()로 정리 후 반환)
InspectionService 
    ↓ (저장)
InspectionItemService
```

### 핵심 차이점

- **Checker → Inspector**: 직접 호출 방식 (`this.inspector.addFinding()`)
- **Inspector → InspectionService**: 반환 방식 (`return itemResults`)
- **InspectionService → InspectionItemService**: 호출 방식 (`await saveItemResult()`)

이렇게 Checker는 결과를 "반환"하지 않고 Inspector에 "직접 추가"하는 방식으로 동작합니다.