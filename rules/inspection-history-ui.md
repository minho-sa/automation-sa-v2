# 🕒 검사 히스토리 UI 표시 로직

## 📋 목차
1. [데이터 소스 개요](#데이터-소스-개요)
2. [히스토리 데이터 조회](#히스토리-데이터-조회)
3. [데이터 변환 및 표시](#데이터-변환-및-표시)
4. [API 데이터 흐름](#api-데이터-흐름)
5. [필터링 및 정렬 로직](#필터링-및-정렬-로직)

---

## 🎯 데이터 소스 개요

검사 히스토리 표시를 위해 **두 가지 주요 데이터 소스**를 사용합니다:

### 1️⃣ **동적 데이터**: 검사 히스토리 레코드
- **소스**: DynamoDB `HISTORY#` 레코드
- **용도**: 시간순 검사 실행 이력
- **특징**: 실시간으로 누적되는 히스토리 데이터

### 2️⃣ **정적 데이터**: 검사 항목 메타데이터
- **파일**: `frontend/src/data/inspectionItems.js`
- **용도**: 검사 항목의 이름, severity 등
- **특징**: 빌드 시 포함되는 정적 데이터

### 🏗️ **히스토리 데이터 구조**

**DynamoDB HISTORY 레코드** (실제 저장 구조):
```javascript
{
  customerId: "user-123",
  itemKey: "HISTORY#EC2#dangerous-ports#9999998359004800#insp-456",
  serviceType: "EC2",
  itemId: "dangerous-ports",
  category: "security",
  inspectionId: "insp-456",
  inspectionTime: 1640995200000,
  findings: [
    {
      resourceId: "sg-12345678",
      resourceType: "SecurityGroup",
      issue: "SSH 포트가 인터넷에 개방됨",
      recommendation: "포트 접근 제한 필요"
    }
  ]
  // ❌ status 필드는 저장되지 않음 (프론트엔드에서 findings 기반 계산)
}
```

**DynamoDB LATEST 레코드** (실제 저장 구조):
```javascript
{
  customerId: "user-123",
  itemKey: "LATEST#EC2#dangerous-ports",
  serviceType: "EC2",
  itemId: "dangerous-ports", 
  category: "security",
  inspectionTime: 1640995200000,
  lastInspectionId: "insp-456",  // 마지막 검사 ID 참조
  findings: [...]
  // ❌ status 필드는 저장되지 않음
}
```

---

## 📊 히스토리 데이터 조회

### 🔄 **API 호출 흐름**

**1. 프론트엔드 API 호출**:
```javascript
// frontend/src/services/inspectionService.js
getItemInspectionHistory: async (params = {}) => {
  const queryParams = new URLSearchParams();
  
  // 필터 파라미터 추가
  if (params.serviceType && params.serviceType !== 'all') {
    queryParams.append('serviceType', params.serviceType);
  }
  if (params.startDate) {
    queryParams.append('startDate', params.startDate);
  }
  if (params.endDate) {
    queryParams.append('endDate', params.endDate);
  }
  // ❌ status 파라미터는 백엔드에서 지원되지 않음
  if (params.historyMode) {
    queryParams.append('historyMode', params.historyMode);
  }
  if (params.limit) {
    queryParams.append('limit', params.limit.toString());
  }
  
  const url = `/inspections/items/history?${queryParams.toString()}`;
  const response = await api.get(url);
  return response.data;
}

// frontend/src/components/InspectionHistory.js
const loadInspectionHistory = async () => {
  const params = {
    serviceType: serviceFilter !== 'all' ? serviceFilter : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    limit: 100
  };
  
  const result = await inspectionService.getItemInspectionHistory(params);
  
  if (result.success) {
    setHistoryItems(result.data.items || []);
  }
};
```

**2. 백엔드 API 처리**:
```javascript
// backend/routes/inspections.js
router.get('/items/history', inspectionController.getItemInspectionHistory);

// backend/controllers/inspectionController.js
const getItemInspectionHistory = async (req, res) => {
  const customerId = req.user.userId;
  const { 
    serviceType, 
    limit = 50,
    startDate,
    endDate,
    historyMode
  } = req.query;
  
  // ❌ status 파라미터는 제거됨 (DynamoDB에 저장되지 않음)

  // 쿼리 파라미터 검증
  const queryLimit = Math.min(parseInt(limit) || 50, 100); // 최대 100개로 제한

  // 항목별 검사 이력 조회
  const result = await historyService.getItemInspectionHistory(
    customerId,
    {
      limit: queryLimit,
      serviceType,
      startDate,
      endDate,
      historyMode
    }
  );
  
  return res.json(ApiResponse.success(result));
};
```

**3. DynamoDB 조회**:
```javascript
// backend/services/historyService.js
async getItemInspectionHistory(params) {
  const { customerId, serviceType, startDate, endDate, limit = 50 } = params;
  
  let queryParams = {
    TableName: 'InspectionItemResults',
    KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :history)',
    ExpressionAttributeValues: {
      ':customerId': customerId,
      ':history': 'HISTORY#'
    },
    Limit: limit,
    ScanIndexForward: false  // 최신순 정렬 (reversedTimestamp 때문)
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
  return {
    success: true,
    items: result.Items || [],
    count: result.Count || 0
  };
}
```

### 📊 **API 응답 데이터 구조**

**API 응답 형식**:
```json
{
  "success": true,
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "items": [
      {
        "customerId": "user-123",
        "itemKey": "HISTORY#EC2#dangerous-ports#9999998359004800#insp-456",
        "serviceType": "EC2",
        "itemId": "dangerous-ports",
        "category": "security",
        "inspectionId": "insp-456",
        "inspectionTime": 1640995200000,
        "findings": [
          {
            "resourceId": "sg-12345678",
            "resourceType": "SecurityGroup",
            "issue": "SSH 포트가 인터넷에 개방됨",
            "recommendation": "포트 접근 제한 필요"
          }
        ]
      },
      {
        "customerId": "user-123",
        "itemKey": "HISTORY#S3#bucket-encryption#9999998359003600#insp-455",
        "serviceType": "S3",
        "itemId": "bucket-encryption",
        "category": "security",
        "inspectionId": "insp-455",
        "inspectionTime": 1640994600000,
        "findings": []
      }
    ],
    "count": 2
  }
}
```

---

## 🔄 데이터 변환 및 표시

### 📊 **enrichItemData 함수**

**파일**: `frontend/src/components/InspectionHistory.js`

```javascript
const enrichItemData = (items) => {
  return items.map((item) => {
    // 검사 요약 생성
    const findingsCount = item.findings ? item.findings.length : 0;
    const resourcesAffected = item.findings ?
      [...new Set(item.findings.map(f => f.resourceId))].length : 0;

    // 기본 severity와 실제 상태 결정
    const baseSeverity = getItemSeverity(item.serviceType, item.itemId);
    const actualStatus = getActualStatus(item);

    return {
      // 기본 정보
      inspectionId: item.lastInspectionId || item.inspectionId,
      serviceType: item.serviceType,
      itemId: item.itemId,

      // 검사 항목 정보 (정적 데이터와 결합)
      inspectionTitle: getItemName(item.serviceType, item.itemId),
      checkName: item.itemId?.toUpperCase().replace(/_/g, '-') || `${item.serviceType}-CHECK`,
      category: getItemInfo(item.serviceType, item.itemId)?.categoryName || '보안 검사',
      
      // 새로운 severity 시스템
      baseSeverity: baseSeverity,        // 기본 severity (CRITICAL 또는 WARN)
      actualStatus: actualStatus,        // 실제 상태 (CRITICAL, WARN, PASS)
      severity: actualStatus,            // UI 호환성을 위해 actualStatus를 severity로 사용

      // 검사 요약
      findingsCount: findingsCount,
      resourcesAffected: resourcesAffected,
      status: item.status,

      // 시간 정보
      timestamp: new Date(item.inspectionTime || Date.now()).toISOString(),

      // 원본 데이터 보존 (상세보기에서 사용)
      originalItem: item,
      findings: item.findings || [],
      recommendations: item.recommendations || []
    };
  });
};
```

### 🎯 **상태 결정 로직**

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
```

### 🎨 **UI 표시 구조**

**컴포넌트**: `frontend/src/components/InspectionHistory.js`

```javascript
return (
  <div className="inspection-history">
    {/* 1. 필터 섹션 */}
    <div className="history-filters">
      <select value={serviceFilter} onChange={handleServiceFilterChange}>
        <option value="all">모든 서비스</option>
        <option value="EC2">EC2</option>
        <option value="RDS">RDS</option>
        <option value="IAM">IAM</option>
        <option value="S3">S3</option>
      </select>
      
      <select value={statusFilter} onChange={handleStatusFilterChange}>
        <option value="all">모든 상태</option>
        <option value="PASS">🟢 검사 완료</option>
        <option value="FAIL">🔴 문제 발견</option>
        <option value="NOT_CHECKED">⚪ 검사 대상 없음</option>
      </select>
      
      <input 
        type="date" 
        value={startDate} 
        onChange={handleStartDateChange}
        placeholder="시작 날짜"
      />
      <input 
        type="date" 
        value={endDate} 
        onChange={handleEndDateChange}
        placeholder="종료 날짜"
      />
    </div>

    {/* 2. 히스토리 목록 */}
    <div className="history-list">
      {filteredItems.map((item, index) => (
        <div key={`${item.inspectionId}-${item.itemId}-${index}`} className="history-item">
          {/* 서비스 정보 */}
          <div className="row-service">
            <span className="service-badge" style={{ 
              backgroundColor: getServiceColor(item.serviceType) 
            }}>
              {item.serviceType}
            </span>
          </div>

          {/* 검사 항목 정보 */}
          <div className="row-inspection">
            <div className="inspection-info">
              <h4 className="inspection-title">{item.inspectionTitle}</h4>
              <span className="inspection-category">{item.category}</span>
            </div>
          </div>

          {/* 검사 결과 */}
          <div className="row-result">
            {getResultSummary(item)}
          </div>

          {/* 심각도 */}
          <div className="row-severity">
            <span 
              className="severity-badge-compact"
              style={{ 
                backgroundColor: getSeverityColor(item.actualStatus) + '20',
                color: getSeverityColor(item.actualStatus),
                borderColor: getSeverityColor(item.actualStatus) + '40'
              }}
            >
              {item.actualStatus}
            </span>
          </div>

          {/* 검사 시간 */}
          <div className="row-time">
            <span className="time-text">{formatDateTime(item.timestamp)}</span>
          </div>

          {/* 상세보기 버튼 */}
          <div className="row-action">
            <button
              className="details-btn-mini"
              onClick={() => handleViewItemDetails(item)}
              title="상세보기"
            >
              📋
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);
```

### 🎯 **결과 요약 표시**

```javascript
const getResultSummary = (item) => {
  const findings = item.findings || [];
  const findingsCount = item.findingsCount || findings.length || 0;
  const actualStatus = item.actualStatus || item.severity;

  if (actualStatus === 'PASS' || findingsCount === 0) {
    return (
      <div className="summary-text success">
        <span className="summary-icon">✅</span>
        <span>정상</span>
      </div>
    );
  }

  // 심각도에 따른 아이콘과 색상 결정
  const severityIcon = getSeverityIcon(actualStatus);
  const severityColor = getSeverityColor(actualStatus);

  return (
    <div className="summary-text warning" style={{ color: severityColor }}>
      <span className="summary-icon">{severityIcon}</span>
      <span>{findingsCount}개 문제 ({actualStatus})</span>
    </div>
  );
};
```

---

## 🔄 API 데이터 흐름

### 📊 **전체 데이터 흐름**

```mermaid
graph TD
    A[InspectionHistory 컴포넌트] --> B[inspectionService.getItemInspectionHistory()]
    B --> C[GET /api/inspections/items/history]
    C --> D[inspectionController.getItemInspectionHistory]
    D --> E[historyService.getItemInspectionHistory]
    E --> F[DynamoDB Query - HISTORY 레코드]
    F --> G[시간순 정렬 (최신순)]
    G --> H[API Response]
    H --> I[enrichItemData - 데이터 변환]
    I --> J[UI 렌더링]
    
    K[inspectionItems.js] --> L[정적 메타데이터]
    L --> I
```

### 🔍 **상세 단계별 처리**

**1단계: 컴포넌트 초기화**
```javascript
// InspectionHistory.js
useEffect(() => {
  loadInspectionHistory();  // 컴포넌트 마운트 시 히스토리 로드
}, []);
```

**2단계: API 호출**
```javascript
const result = await inspectionService.getItemInspectionHistory(params);
// → GET /api/inspections/items/history?serviceType=EC2&limit=100
```

**3단계: 백엔드 처리**
```javascript
// inspectionController.js
const customerId = req.user.userId;
const result = await historyService.getItemInspectionHistory(params);
```

**4단계: DynamoDB 조회**
```javascript
// historyService.js
// HISTORY# 접두사로 시작하는 모든 레코드 조회 (최신순)
KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :history)'
ScanIndexForward: false  // reversedTimestamp로 최신순 정렬
```

**5단계: 프론트엔드 데이터 변환**
```javascript
// InspectionHistory.js
const enrichedItems = useMemo(() => {
  return enrichItemData(historyItems);
}, [historyItems]);
```

**6단계: UI 렌더링**
```javascript
// 필터링된 아이템들을 시간순으로 표시
{filteredItems.map(item => <HistoryItem key={item.id} item={item} />)}
```

---

## 🔍 필터링 및 정렬 로직

### 📊 **서버 사이드 필터링**

**백엔드에서 지원하는 필터**:
- `serviceType`: 특정 서비스만 조회 (EC2, S3, IAM, RDS 등)
- `startDate`: 시작 날짜 이후 검사만
- `endDate`: 종료 날짜 이전 검사만
- `historyMode`: 조회 모드 ('history' 또는 'latest')
- `limit`: 조회할 최대 개수 (기본 50, 최대 100)

**❌ 지원되지 않는 필터**:
- `status`: DynamoDB에 status 필드가 저장되지 않음 (프론트엔드에서 findings 기반 계산)

```javascript
// backend/services/historyService.js
async getItemInspectionHistory(customerId, options = {}) {
  const { limit = 50, serviceType, startDate, endDate, status, historyMode = 'history' } = options;

  // 1. KeyConditionExpression 구성 (서비스 타입 필터)
  let keyConditionExpression = 'customerId = :customerId';
  const itemKeyPrefix = historyMode === 'latest' ? 'LATEST#' : 'HISTORY#';
  
  if (serviceType && serviceType !== 'all') {
    keyConditionExpression += ' AND begins_with(itemKey, :itemKeyPrefix)';
    expressionAttributeValues[':itemKeyPrefix'] = `${itemKeyPrefix}${serviceType}#`;
  } else {
    keyConditionExpression += ' AND begins_with(itemKey, :itemKeyPrefix)';
    expressionAttributeValues[':itemKeyPrefix'] = itemKeyPrefix;
  }

  // 2. FilterExpression 구성 (날짜, 상태 필터)
  const filterConditions = [];

  // 날짜 범위 필터
  if (startDate) {
    const startTimestamp = new Date(startDate).getTime();
    filterConditions.push('inspectionTime >= :startTime');
    expressionAttributeValues[':startTime'] = startTimestamp;
  }

  if (endDate) {
    const endTimestamp = new Date(endDate).getTime();
    filterConditions.push('inspectionTime <= :endTime');
    expressionAttributeValues[':endTime'] = endTimestamp;
  }

  // ❌ 상태 필터는 실제로 지원되지 않음 (status 필드가 저장되지 않음)
  // 프론트엔드에서 findings 기반으로 상태를 계산하므로 백엔드 필터링 불가능

  if (filterConditions.length > 0) {
    params.FilterExpression = filterConditions.join(' AND ');
  }
}

// ❌ mapToItemStatus 함수는 실제로 사용되지 않음
// status 필드가 DynamoDB에 저장되지 않으므로 상태 필터링 불가능
```

### 📈 **클라이언트 사이드 필터링**

```javascript
// InspectionHistory.js
const filteredItems = useMemo(() => {
  return enrichedItems.filter(item => {
    // 서비스 타입 필터
    if (serviceFilter !== 'all' && item.serviceType !== serviceFilter) {
      return false;
    }
    
    // 상태 필터
    if (statusFilter !== 'all') {
      const normalizedStatus = normalizeStatus(item.severity);
      if (normalizedStatus !== statusFilter) {
        return false;
      }
    }
    
    // 날짜 범위 필터 (추가 클라이언트 필터링)
    const itemDate = new Date(item.timestamp);
    if (startDate && itemDate < new Date(startDate)) {
      return false;
    }
    if (endDate && itemDate > new Date(endDate + 'T23:59:59')) {
      return false;
    }
    
    return true;
  });
}, [enrichedItems, serviceFilter, statusFilter, startDate, endDate]);

// 상태 정규화 함수
const normalizeStatus = (severity) => {
  if (severity === 'PASS') return 'PASS';
  if (severity === 'CRITICAL' || severity === 'WARN') return 'FAIL';
  return 'NOT_CHECKED';
};
```

### ⚡ **성능 최적화**

**1. 페이지네이션**:
```javascript
// 기본 50개씩 로드
const DEFAULT_LIMIT = 50;

// 더 보기 기능
const loadMoreHistory = async () => {
  const params = {
    ...currentFilters,
    limit: DEFAULT_LIMIT,
    lastEvaluatedKey: lastKey  // 다음 페이지 키
  };
  
  const result = await inspectionService.getItemInspectionHistory(params);
  setHistoryItems(prev => [...prev, ...result.data.items]);
};
```

**2. 메모이제이션**:
```javascript
// 데이터 변환 결과 캐싱
const enrichedItems = useMemo(() => {
  return enrichItemData(historyItems);
}, [historyItems]);

// 필터링 결과 캐싱
const filteredItems = useMemo(() => {
  return applyFilters(enrichedItems);
}, [enrichedItems, serviceFilter, statusFilter, startDate, endDate]);
```

---

## 📊 데이터 결합 예시

### 🔄 **백엔드 데이터 + 프론트엔드 메타데이터**

**백엔드 응답**:
```javascript
{
  serviceType: "EC2",
  itemId: "dangerous-ports",
  inspectionTime: 1640995200000,
  findings: [{ resourceId: "sg-123", issue: "..." }]
}
```

**프론트엔드 메타데이터** (inspectionItems.js):
```javascript
{
  id: "dangerous-ports",
  name: "보안 그룹 - 위험한 포트 노출",
  severity: "CRITICAL"
}
```

**최종 UI 표시 데이터**:
```javascript
{
  serviceType: "EC2",
  itemId: "dangerous-ports",
  inspectionTitle: "보안 그룹 - 위험한 포트 노출",  // 정적 데이터
  baseSeverity: "CRITICAL",                        // 정적 데이터
  actualStatus: "CRITICAL",                       // 계산된 값 (findings 있음)
  findingsCount: 1,                               // 계산된 값
  timestamp: "2024-01-01T00:00:00Z",             // 백엔드 데이터
  findings: [...],                                // 백엔드 데이터
  color: "#DC2626",                              // 계산된 값
  icon: "🚨"                                     // 계산된 값
}
```

---

## 📋 요약

### ✅ **핵심 포인트**

1. **데이터 소스**:
   - 동적: DynamoDB HISTORY 레코드 (시간순 정렬)
   - 정적: `inspectionItems.js` (메타데이터)

2. **API 데이터 흐름**:
   - 필터 파라미터 → DynamoDB 조회 → 데이터 변환 → UI 표시

3. **상태 결정 로직**:
   - 백엔드: findings 배열만 반환
   - 프론트엔드: findings + severity → 최종 상태

4. **필터링 시스템**:
   - 서버사이드: serviceType, startDate, endDate, historyMode, limit
   - 클라이언트사이드: 상태별 (findings 기반 계산), 추가 조건별 필터링

5. **성능 최적화**:
   - 페이지네이션 (50개씩 로드)
   - 메모이제이션 (useMemo 활용)

### 🎯 **데이터 흐름 요약**
```
DynamoDB HISTORY → API 조회 → enrichItemData 변환 → 필터링 → UI 표시
```

### 🔧 **주요 특징**
- **실시간 상태 계산**: findings 배열 기반 동적 상태 결정
- **유연한 필터링**: 서비스, 상태, 날짜 범위별 필터
- **상세 정보**: 각 검사 항목별 findings와 권장사항 표시
- **시간순 정렬**: 최신 검사부터 표시 (reversedTimestamp 활용)