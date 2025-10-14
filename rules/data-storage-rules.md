# 📊 검사 데이터 저장/조회 규칙

## 🎯 개요

AWS 보안 검사 시스템의 **데이터 저장 및 조회에 대한 구체적인 규칙**을 정의합니다.

---

## 📋 DynamoDB 테이블 구조

### 🗄️ **테이블명**: `InspectionItemResults`

**Primary Key**:
- `customerId` (String, HASH) - 고객 ID
- `itemKey` (String, RANGE) - 아이템 식별키

**Attributes**:
- `serviceType` (String) - 서비스 타입 (EC2, RDS, IAM, S3) - 서비스별 분류용
- `itemId` (String) - 검사 항목 ID - 프론트엔드 매핑용
- `category` (String) - 카테고리 (security, cost-optimization, performance) - 카테고리별 분류용
- `findings` (List) - 발견된 문제 배열 - 핵심 데이터
- `inspectionId` (String) - 검사 ID (HISTORY 레코드만)
- `inspectionTime` (Number) - 검사 시간 (Unix timestamp)
- `lastInspectionId` (String) - 마지막 검사 ID (LATEST 레코드만)

**제거된 필드들** (프론트엔드에서 계산):
- ~~`status`~~ - findings 유무 + baseSeverity로 결정
- ~~`totalResources`~~ - 실제 사용되지 않음
- ~~`issuesFound`~~ - findings.length로 계산
- ~~`score`~~ - 복잡한 점수 계산 불필요
- ~~`summary`~~ - 프론트엔드에서 생성

---

## 🔑 itemKey 생성 규칙

### 📊 **LATEST 레코드** (최신 결과)
```
형식: "LATEST#{serviceType}#{itemId}"
예시: "LATEST#EC2#dangerous-ports"
```

**용도**: 
- 특정 검사 항목의 최신 상태 빠른 조회
- 대시보드 현재 상태 표시

### 📈 **HISTORY 레코드** (히스토리)
```
형식: "HISTORY#{serviceType}#{itemId}#{reversedTimestamp}#{inspectionId}"
예시: "HISTORY#EC2#dangerous-ports#9999998359004800#insp-456"
```

**reversedTimestamp 계산**:
```javascript
const reversedTimestamp = (9999999999999 - timestamp).toString().padStart(13, '0');
```

**용도**:
- 시간순 히스토리 조회 (최신이 먼저)
- 특정 검사의 모든 항목 결과 조회

---

## 💾 데이터 저장 규칙

### 1️⃣ **검사 완료 시 저장**

**저장 위치**: `backend/services/inspectionItemService.js`

**저장 프로세스**:
```javascript
async saveItemResult(customerId, inspectionId, itemResult) {
  const now = Date.now();
  
  // 1. HISTORY 레코드 저장
  const historyKey = helpers.createHistoryKey(
    itemResult.serviceType,
    itemResult.itemId, 
    now,
    inspectionId
  );
  
  const historyItem = {
    customerId,
    itemKey: historyKey,
    serviceType: itemResult.serviceType,
    itemId: itemResult.itemId,
    inspectionId,
    inspectionTime: now,
    status: itemResult.status,
    totalResources: itemResult.totalResources || 0,
    issuesFound: itemResult.issuesFound || 0,
    findings: itemResult.findings || []
  };
  
  // 2. LATEST 레코드 저장 (덮어쓰기)
  const latestKey = helpers.createLatestKey(
    itemResult.serviceType,
    itemResult.itemId
  );
  
  const latestItem = {
    ...historyItem,
    itemKey: latestKey,
    lastInspectionId: inspectionId  // 마지막 검사 ID 추가
  };
  
  // 3. 배치 저장
  await Promise.all([
    dynamoDB.put({ Item: historyItem }),
    dynamoDB.put({ Item: latestItem })
  ]);
}
```

### 2️⃣ **저장 데이터 형식**

**LATEST 레코드 예시** (단순화된 모델):
```json
{
  "customerId": "user-123",
  "itemKey": "LATEST#EC2#dangerous-ports",
  "serviceType": "EC2",
  "itemId": "dangerous-ports",
  "category": "security",
  "inspectionTime": 1640995200000,
  "lastInspectionId": "insp-456",
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

**HISTORY 레코드 예시** (단순화된 모델):
```json
{
  "customerId": "user-123",
  "itemKey": "HISTORY#EC2#dangerous-ports#9999998359004800#insp-456",
  "serviceType": "EC2",
  "itemId": "dangerous-ports",
  "category": "security",
  "inspectionId": "insp-456",
  "inspectionTime": 1640995200000,
  "findings": [...]
}
```

**프론트엔드에서 계산되는 값들**:
```javascript
// 상태 결정
const status = findings.length > 0 ? baseSeverity : 'PASS';

// 요약 정보
const summary = {
  issuesFound: findings.length,
  resourcesAffected: [...new Set(findings.map(f => f.resourceId))].length
};
```

---

## 🔍 데이터 조회 규칙

### 1️⃣ **최신 상태 조회**

**API**: `GET /api/inspections/items/status`
**구현**: `backend/services/historyService.js`

```javascript
async getLatestResults(customerId, serviceType = 'ALL') {
  const params = {
    TableName: this.tableName,
    KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :latest)',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':latest': 'LATEST#'
    }
  };
  
  // 특정 서비스만 조회
  if (serviceType !== 'ALL') {
    params.FilterExpression = 'serviceType = :serviceType';
    params.ExpressionAttributeValues[':serviceType'] = serviceType;
  }
  
  const result = await this.client.query(params);
  return result.Items;
}
```

### 2️⃣ **특정 항목 히스토리 조회**

**API**: `GET /api/inspections/items/{serviceType}/{itemId}/history`
**구현**: `backend/services/historyService.js`

```javascript
async getItemInspectionHistory(params) {
  const { customerId, serviceType, itemId, limit = 50 } = params;
  
  const historyPrefix = `HISTORY#${serviceType}#${itemId}#`;
  
  const queryParams = {
    TableName: this.tableName,
    KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :historyPrefix)',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':historyPrefix': historyPrefix
    },
    Limit: limit,
    ScanIndexForward: false  // 최신순 정렬
  };
  
  const result = await this.client.query(queryParams);
  return result.Items;
}
```

### 3️⃣ **전체 히스토리 조회 (시간 범위)**

**API**: `GET /api/inspections/items/history`
**구현**: `backend/services/historyService.js`

```javascript
async getItemInspectionHistory(params) {
  const { customerId, startDate, endDate, serviceType, limit = 50 } = params;
  
  let queryParams = {
    TableName: this.tableName,
    KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :history)',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':history': 'HISTORY#'
    },
    Limit: limit,
    ScanIndexForward: false
  };
  
  // 필터 조건 추가
  const filterExpressions = [];
  
  if (startDate) {
    filterExpressions.push('inspectionTime >= :startDate');
    queryParams.ExpressionAttributeValues[':startDate'] = new Date(startDate).getTime();
  }
  
  if (endDate) {
    filterExpressions.push('inspectionTime <= :endDate');
    queryParams.ExpressionAttributeValues[':endDate'] = new Date(endDate).getTime();
  }
  
  if (serviceType && serviceType !== 'all') {
    filterExpressions.push('serviceType = :serviceType');
    queryParams.ExpressionAttributeValues[':serviceType'] = serviceType;
  }
  
  if (filterExpressions.length > 0) {
    queryParams.FilterExpression = filterExpressions.join(' AND ');
  }
  
  const result = await this.client.query(queryParams);
  return result.Items;
}
```

### 4️⃣ **특정 검사의 모든 항목 조회**

**API**: `GET /api/inspections/{inspectionId}`
**구현**: `backend/services/historyService.js`

```javascript
async getInspectionResults(customerId, inspectionId) {
  // GSI 사용 (customerId-inspectionId-index)
  const params = {
    TableName: this.tableName,
    IndexName: 'customerId-inspectionId-index',
    KeyConditionExpression: 'customerId = :customerId AND inspectionId = :inspectionId',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':inspectionId': inspectionId
    }
  };
  
  const result = await this.client.query(params);
  return result.Items;
}
```

---

## 📊 데이터 변환 규칙

### 1️⃣ **저장 시 데이터 변환**

**InspectionFinding → DynamoDB Item**:
```javascript
// backend/services/inspectionItemService.js
function transformForStorage(itemResult, customerId, inspectionId) {
  return {
    customerId,
    itemKey: helpers.createLatestKey(itemResult.serviceType, itemResult.itemId),
    serviceType: itemResult.serviceType,
    itemId: itemResult.itemId,
    category: itemResult.category || 'security',
    inspectionId,
    inspectionTime: Date.now(),
    status: determineStatus(itemResult.findings),
    totalResources: itemResult.totalResources || 0,
    issuesFound: itemResult.findings?.length || 0,
    findings: itemResult.findings?.map(f => f.toApiResponse()) || []
  };
}

function determineStatus(findings) {
  if (!findings || findings.length === 0) {
    return 'PASS';
  }
  return 'FAIL';
}
```

### 2️⃣ **조회 시 데이터 변환**

**DynamoDB Item → API Response**:
```javascript
// backend/services/historyService.js
function transformForApi(items) {
  return items.map(item => ({
    serviceType: item.serviceType,
    itemId: item.itemId,
    category: item.category,
    inspectionId: item.inspectionId,
    inspectionTime: item.inspectionTime,
    status: item.status,
    totalResources: item.totalResources || 0,
    issuesFound: item.issuesFound || 0,
    findings: item.findings || [],
    
    // 추가 메타데이터
    lastInspectionId: item.lastInspectionId,
    recordType: item.itemKey.startsWith('LATEST#') ? 'LATEST' : 'HISTORY'
  }));
}
```

---

## 🔄 데이터 일관성 규칙

### 1️⃣ **LATEST vs HISTORY 동기화**

**규칙**: HISTORY 저장 성공 시에만 LATEST 업데이트
```javascript
async saveItemResult(customerId, inspectionId, itemResult) {
  try {
    // 1. HISTORY 먼저 저장
    await this.saveHistoryRecord(historyItem);
    
    // 2. HISTORY 저장 성공 시에만 LATEST 업데이트
    await this.saveLatestRecord(latestItem);
    
    return { success: true };
  } catch (error) {
    // HISTORY 저장 실패 시 LATEST 업데이트 안함
    throw error;
  }
}
```

### 2️⃣ **부분 실패 처리**

**규칙**: 일부 항목 저장 실패 시에도 성공한 항목은 유지
```javascript
async saveMultipleItems(customerId, inspectionId, itemResults) {
  const results = [];
  
  for (const itemResult of itemResults) {
    try {
      await this.saveItemResult(customerId, inspectionId, itemResult);
      results.push({ itemId: itemResult.itemId, success: true });
    } catch (error) {
      results.push({ 
        itemId: itemResult.itemId, 
        success: false, 
        error: error.message 
      });
    }
  }
  
  return results;
}
```

### 3️⃣ **중복 저장 방지**

**규칙**: 동일한 inspectionId + itemId 조합은 중복 저장 안함
```javascript
async saveItemResult(customerId, inspectionId, itemResult) {
  // 중복 체크
  const existingKey = helpers.createHistoryKey(
    itemResult.serviceType,
    itemResult.itemId,
    Date.now(),
    inspectionId
  );
  
  const existing = await this.getExistingRecord(customerId, existingKey);
  if (existing) {
    return { success: true, message: 'Already exists' };
  }
  
  // 새로 저장
  return await this.performSave(customerId, inspectionId, itemResult);
}
```

---

## 📈 성능 최적화 규칙

### 1️⃣ **배치 처리**

**규칙**: 여러 항목 저장 시 배치 처리 사용
```javascript
async saveBatchItems(items) {
  const batchSize = 25; // DynamoDB 배치 제한
  const batches = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  const results = await Promise.all(
    batches.map(batch => this.processBatch(batch))
  );
  
  return results.flat();
}
```

### 2️⃣ **조회 최적화**

**규칙**: 
- 최신 상태 조회 시 LATEST 레코드만 사용
- 히스토리 조회 시 필요한 범위만 조회
- 페이지네이션 적용

```javascript
async getLatestResultsOptimized(customerId, serviceType) {
  const params = {
    TableName: this.tableName,
    KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :latest)',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':latest': serviceType === 'ALL' ? 'LATEST#' : `LATEST#${serviceType}#`
    },
    ProjectionExpression: 'itemKey, serviceType, itemId, #status, inspectionTime, issuesFound',
    ExpressionAttributeNames: {
      '#status': 'status'
    }
  };
  
  return await this.client.query(params);
}
```

### 3️⃣ **캐싱 전략**

**규칙**: LATEST 레코드는 메모리 캐싱 적용 (5분)
```javascript
class HistoryService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5분
  }
  
  async getLatestResultsCached(customerId, serviceType) {
    const cacheKey = `${customerId}:${serviceType}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    
    const data = await this.getLatestResults(customerId, serviceType);
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  }
}
```

---

## 🚨 에러 처리 규칙

### 1️⃣ **저장 실패 처리**

```javascript
async saveItemResult(customerId, inspectionId, itemResult) {
  try {
    return await this.performSave(customerId, inspectionId, itemResult);
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      // 중복 저장 시도
      return { success: true, message: 'Already exists' };
    }
    
    if (error.code === 'ProvisionedThroughputExceededException') {
      // 처리량 초과 시 재시도
      await this.sleep(1000);
      return await this.saveItemResult(customerId, inspectionId, itemResult);
    }
    
    throw error;
  }
}
```

### 2️⃣ **조회 실패 처리**

```javascript
async getLatestResults(customerId, serviceType) {
  try {
    const result = await this.client.query(params);
    return {
      success: true,
      items: result.Items || [],
      count: result.Count || 0
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      items: [],
      count: 0
    };
  }
}
```

---

## 📊 데이터 검증 규칙

### 1️⃣ **저장 전 검증**

```javascript
function validateItemResult(itemResult) {
  const errors = [];
  
  if (!itemResult.serviceType) {
    errors.push('serviceType is required');
  }
  
  if (!itemResult.itemId) {
    errors.push('itemId is required');
  }
  
  if (!['EC2', 'RDS', 'IAM', 'S3'].includes(itemResult.serviceType)) {
    errors.push('Invalid serviceType');
  }
  
  if (itemResult.findings && !Array.isArray(itemResult.findings)) {
    errors.push('findings must be an array');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
```

### 2️⃣ **데이터 무결성 검증**

```javascript
function validateDataIntegrity(item) {
  const findings = item.findings || [];
  const issuesFound = item.issuesFound || 0;
  
  // findings 배열과 issuesFound 일치 검증
  if (findings.length !== issuesFound) {
    return {
      isValid: false,
      error: 'findings count mismatch'
    };
  }
  
  // status와 findings 일치 검증
  const expectedStatus = findings.length > 0 ? 'FAIL' : 'PASS';
  if (item.status !== expectedStatus) {
    return {
      isValid: false,
      error: 'status mismatch with findings'
    };
  }
  
  return { isValid: true };
}
```

---

## 📋 요약

### ✅ **핵심 규칙**
1. **이중 저장**: LATEST + HISTORY 레코드 동시 저장
2. **시간순 정렬**: reversedTimestamp로 최신순 조회
3. **배치 처리**: 여러 항목 동시 저장 시 배치 사용
4. **에러 처리**: 부분 실패 허용, 중복 저장 방지
5. **성능 최적화**: 캐싱, 프로젝션, 페이지네이션 적용

### 🔍 **조회 패턴**
- **최신 상태**: LATEST 레코드 조회
- **히스토리**: HISTORY 레코드 시간순 조회
- **특정 검사**: GSI로 inspectionId 기반 조회
- **필터링**: 서비스 타입, 시간 범위, 상태별 필터

### 💾 **저장 패턴**
- **검사 완료 시**: 즉시 LATEST + HISTORY 저장
- **배치 검사**: 모든 항목 완료 후 일괄 저장
- **실패 처리**: 성공한 항목만 저장, 실패 로그 기록