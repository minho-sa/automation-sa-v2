# 🎨 프론트엔드 검사 항목 표시 로직

## 📋 목차
1. [데이터 소스 개요](#데이터-소스-개요)
2. [검사 항목 정보 표시](#검사-항목-정보-표시)
3. [최근 검사 결과 표시](#최근-검사-결과-표시)
4. [API 데이터 흐름](#api-데이터-흐름)
5. [상태 결정 로직](#상태-결정-로직)

---

## 🎯 데이터 소스 개요

프론트엔드에서 검사 항목을 표시하기 위해 **두 가지 주요 데이터 소스**를 사용합니다:

### 1️⃣ **정적 데이터**: 검사 항목 정의
- **파일**: `frontend/src/data/inspectionItems.js`
- **용도**: 검사 항목의 메타데이터 (이름, 설명, severity 등)
- **특징**: 빌드 시 포함되는 정적 데이터

### 2️⃣ **동적 데이터**: 최근 검사 결과
- **API**: `GET /api/inspections/items/status`
- **용도**: 각 검사 항목의 최신 실행 결과
- **특징**: 실시간으로 업데이트되는 동적 데이터

---

## 📊 검사 항목 정보 표시

### 🏗️ **데이터 구조**

**정적 데이터 구조** (`frontend/src/data/inspectionItems.js`):
```javascript
export const inspectionItems = {
  EC2: {
    id: 'EC2',
    name: 'Amazon EC2',
    description: 'EC2 인스턴스 보안 검사',
    icon: '🖥️',
    color: '#FF9900',
    categories: [
      {
        id: 'security',
        name: '보안',
        description: 'EC2 보안 설정 검사',
        items: [
          {
            id: 'dangerous-ports',
            name: '보안 그룹 - 위험한 포트 노출',
            shortDescription: 'SSH, RDP 등 위험한 포트의 인터넷 노출 검사',
            description: '상세한 검사 설명...',
            severity: 'CRITICAL',  // 🎯 프론트엔드에서만 정의
            enabled: true
          }
        ]
      }
    ]
  }
};
```

### 🎨 **표시 로직**

**컴포넌트**: `frontend/src/components/ServiceInspectionSelector.js`

```javascript
// 1. 서비스 목록 표시
{Object.values(inspectionItems).map(service => (
  <button key={service.id} className="service-tab">
    <span style={{ color: service.color }}>{service.icon}</span>
    {service.name}
  </button>
))}

// 2. 검사 항목 목록 표시
{inspectionItems[selectedService].categories.map(category => (
  <div key={category.id} className="check-category">
    <h3>{category.name}</h3>
    {category.items.map(item => (
      <div key={item.id} className="check-item">
        <span className="severity-badge" style={{ 
          backgroundColor: severityColors[item.severity] 
        }}>
          {item.severity}
        </span>
        <div className="item-info">
          <h4>{item.name}</h4>
          <p>{item.shortDescription}</p>
        </div>
      </div>
    ))}
  </div>
))}
```

---

## 📈 최근 검사 결과 표시

### 🔄 **API 호출 흐름**

**1. 프론트엔드 API 호출**:
```javascript
// frontend/src/services/inspectionService.js
getAllItemStatus: async () => {
  return withRetry(async () => {
    const response = await api.get('/inspections/items/status');
    return response.data;
  });
}

// frontend/src/components/ServiceInspectionSelector.js
const loadAllItemStatuses = async () => {
  const result = await inspectionService.getAllItemStatus();
  
  if (result.success) {
    // API 응답: { services: { EC2: { "dangerous-ports": {...} } } }
    setItemStatuses(result.data.services || {});
  }
};
```

**2. 백엔드 API 처리**:
```javascript
// backend/routes/inspections.js
router.get('/items/status', inspectionController.getAllItemStatus);

// backend/controllers/inspectionController.js
const getAllItemStatus = async (req, res) => {
  const customerId = req.user.userId;
  
  // HistoryService에서 최신 결과 조회
  const historyService = require('../services/historyService');
  const result = await historyService.getLatestInspectionResults(customerId);
  
  return res.json(ApiResponse.success(result.data));
};
```

**3. DynamoDB 조회**:
```javascript
// backend/services/historyService.js
async getLatestInspectionResults(customerId, serviceType = null) {
  const params = {
    TableName: 'InspectionItemResults',
    KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :latest)',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':latest': 'LATEST#'  // LATEST 레코드만 조회
    }
  };
  
  const result = await this.client.send(new QueryCommand(params));
  return this.groupItemsByService(result.Items);
}
```

### 📊 **API 응답 데이터 구조**

**API 응답 형식**:
```json
{
  "success": true,
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "services": {
      "EC2": {
        "dangerous-ports": {
          "status": "FAIL",
          "inspectionTime": 1640995200000,
          "inspectionId": "insp-456",
          "issuesFound": 3,
          "resourcesScanned": 10,
          "findings": [
            {
              "resourceId": "sg-12345678",
              "resourceType": "SecurityGroup",
              "issue": "SSH 포트가 인터넷에 개방됨",
              "recommendation": "포트 접근 제한 필요"
            }
          ]
        },
        "ebs-encryption": {
          "status": "PASS",
          "inspectionTime": 1640995200000,
          "inspectionId": "insp-456",
          "issuesFound": 0,
          "resourcesScanned": 5,
          "findings": []
        }
      },
      "S3": {
        "bucket-encryption": {
          "status": "FAIL",
          "inspectionTime": 1640995100000,
          "inspectionId": "insp-455",
          "issuesFound": 2,
          "resourcesScanned": 8,
          "findings": [...]
        }
      }
    }
  }
}
```

---

## 🔄 API 데이터 흐름

### 📊 **전체 데이터 흐름**

```mermaid
graph TD
    A[ServiceInspectionSelector 컴포넌트] --> B[inspectionService.getAllItemStatus()]
    B --> C[GET /api/inspections/items/status]
    C --> D[inspectionController.getAllItemStatus]
    D --> E[historyService.getLatestInspectionResults]
    E --> F[DynamoDB Query - LATEST 레코드]
    F --> G[groupItemsByService - 서비스별 그룹화]
    G --> H[API Response]
    H --> I[setItemStatuses - 상태 업데이트]
    I --> J[UI 렌더링]
    
    K[inspectionItems.js] --> L[정적 메타데이터]
    L --> J
```

### 🔍 **상세 단계별 처리**

**1단계: 컴포넌트 초기화**
```javascript
// ServiceInspectionSelector.js
useEffect(() => {
  loadAllItemStatuses();  // 컴포넌트 마운트 시 최신 상태 로드
}, []);
```

**2단계: API 호출**
```javascript
const result = await inspectionService.getAllItemStatus();
// → GET /api/inspections/items/status
```

**3단계: 백엔드 처리**
```javascript
// inspectionController.js
const customerId = req.user.userId;
const result = await historyService.getLatestInspectionResults(customerId);
```

**4단계: DynamoDB 조회**
```javascript
// historyService.js
// LATEST# 접두사로 시작하는 모든 레코드 조회
KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :latest)'
```

**5단계: 데이터 그룹화**
```javascript
// historyService.js - groupItemsByService
const services = {};
items.forEach(item => {
  const serviceType = item.serviceType;  // EC2, S3, IAM, RDS
  const itemId = parsed.itemId;          // dangerous-ports, bucket-encryption
  
  services[serviceType][itemId] = {
    status: item.status,
    inspectionTime: item.inspectionTime,
    issuesFound: item.findings?.length || 0,
    findings: item.findings || []
  };
});
```

**6단계: 프론트엔드 상태 업데이트**
```javascript
// ServiceInspectionSelector.js
setItemStatuses(result.data.services || {});
// → { EC2: { "dangerous-ports": {...} }, S3: { "bucket-encryption": {...} } }
```

---

## 🎯 상태 결정 로직

### 🔄 **프론트엔드 상태 결정**

**파일**: `frontend/src/utils/itemMappings.js`

```javascript
// 1. 기본 severity 조회 (정적 데이터)
export const getItemSeverity = (serviceType, itemId) => {
  return InspectionResultModel.getBaseSeverity(serviceType, itemId);
};

// 2. 실제 상태 결정 (동적 데이터 + 정적 데이터)
export const getActualStatus = (item) => {
  const baseSeverity = getItemSeverity(item.serviceType, item.itemId);
  const findings = item.findings || [];
  
  // 핵심 로직: findings 유무 + baseSeverity → 최종 상태
  return findings.length === 0 ? 'PASS' : baseSeverity;
};

// 3. UI 표시용 변환
export const transformInspectionResults = (results) => {
  return results.map(item => {
    const actualStatus = getActualStatus(item);
    
    return {
      ...item,
      actualStatus,
      color: severityColors[actualStatus],
      icon: severityIcons[actualStatus],
      summary: generateItemSummary(item.findings)
    };
  });
};
```

### 🎨 **UI 표시 로직**

**컴포넌트에서 상태 표시**:
```javascript
// ServiceInspectionSelector.js
const getItemStatus = (serviceType, itemId) => {
  const itemStatus = itemStatuses[serviceType]?.[itemId];
  
  if (!itemStatus) {
    return { status: 'NOT_CHECKED', color: '#6b7280' };
  }
  
  // 프론트엔드에서 상태 결정
  const baseSeverity = getItemSeverity(serviceType, itemId);
  const actualStatus = itemStatus.findings?.length > 0 ? baseSeverity : 'PASS';
  
  return {
    status: actualStatus,
    color: severityColors[actualStatus],
    lastChecked: itemStatus.inspectionTime,
    issuesFound: itemStatus.findings?.length || 0
  };
};

// UI 렌더링
<div className="item-status">
  <span 
    className="status-indicator"
    style={{ backgroundColor: getItemStatus(serviceType, item.id).color }}
  >
    {getItemStatus(serviceType, item.id).status}
  </span>
  <span className="issues-count">
    {getItemStatus(serviceType, item.id).issuesFound}개 문제
  </span>
</div>
```

---

## 📊 데이터 결합 예시

### 🔄 **정적 + 동적 데이터 결합**

**정적 데이터** (inspectionItems.js):
```javascript
{
  id: 'dangerous-ports',
  name: '보안 그룹 - 위험한 포트 노출',
  severity: 'CRITICAL',
  enabled: true
}
```

**동적 데이터** (API 응답):
```javascript
{
  "dangerous-ports": {
    "status": "FAIL",
    "inspectionTime": 1640995200000,
    "findings": [
      {
        "resourceId": "sg-12345678",
        "issue": "SSH 포트가 인터넷에 개방됨"
      }
    ]
  }
}
```

**최종 UI 표시**:
```javascript
{
  id: 'dangerous-ports',
  name: '보안 그룹 - 위험한 포트 노출',    // 정적 데이터
  severity: 'CRITICAL',                    // 정적 데이터
  actualStatus: 'CRITICAL',               // 동적 계산 (findings 있음 + CRITICAL)
  lastChecked: 1640995200000,             // 동적 데이터
  issuesFound: 1,                         // 동적 계산 (findings.length)
  color: '#DC2626',                       // 계산된 값
  findings: [...]                         // 동적 데이터
}
```

---

## 🚀 성능 최적화

### ⚡ **캐싱 전략**

**1. API 응답 캐싱**:
```javascript
// 5분간 캐싱
const CACHE_DURATION = 5 * 60 * 1000;
let cachedData = null;
let cacheTimestamp = 0;

const getAllItemStatusCached = async () => {
  const now = Date.now();
  
  if (cachedData && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedData;
  }
  
  const result = await inspectionService.getAllItemStatus();
  cachedData = result;
  cacheTimestamp = now;
  
  return result;
};
```

**2. 컴포넌트 메모이제이션**:
```javascript
// React.memo로 불필요한 리렌더링 방지
const ServiceInspectionSelector = React.memo(({ onSelectionChange }) => {
  // 컴포넌트 로직
});

// useMemo로 계산 결과 캐싱
const processedItems = useMemo(() => {
  return transformInspectionResults(itemStatuses);
}, [itemStatuses]);
```

---

## 📋 요약

### ✅ **핵심 포인트**

1. **이중 데이터 소스**:
   - 정적: `inspectionItems.js` (메타데이터)
   - 동적: `/api/inspections/items/status` (실행 결과)

2. **상태 결정 로직**:
   - 백엔드: findings 배열만 반환
   - 프론트엔드: findings + severity → 최종 상태

3. **API 데이터 흐름**:
   - DynamoDB LATEST 레코드 조회
   - 서비스별 그룹화
   - 프론트엔드에서 정적 데이터와 결합

4. **성능 최적화**:
   - API 응답 캐싱 (5분)
   - 컴포넌트 메모이제이션
   - 필요한 데이터만 조회

### 🎯 **데이터 흐름 요약**
```
정적 데이터 (inspectionItems.js) + 동적 데이터 (API) → 상태 계산 → UI 표시
```