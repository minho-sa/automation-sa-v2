/**
 * 검사 항목별 결과 모델 (최적화된 구조)
 * recordType 기반 정렬키로 LATEST/HISTORY 효율적 조회
 */

const InspectionItemResultSchema = {
  // Primary Key
  customerId: 'string', // 고객 ID (HASH)
  itemKey: 'string', // 아이템 식별키 (RANGE) - 아래 구조 참조

  // itemKey 구조:
  // LATEST: "LATEST#{serviceType}#{itemId}"
  // HISTORY: "HISTORY#{serviceType}#{itemId}#{timestamp}#{inspectionId}"

  // 검사 정보
  serviceType: 'string', // EC2, RDS, S3, IAM
  itemId: 'string', // dangerous_ports, bucket_encryption 등
  category: 'string', // security, performance, cost

  // 검사 결과
  inspectionId: 'string', // 검사 ID (HISTORY만 필요, LATEST는 선택적)
  inspectionTime: 'number', // 검사 시간 (timestamp)
  status: 'string', // PASS, FAIL, WARNING, NOT_CHECKED

  // 결과 요약
  totalResources: 'number', // 검사된 리소스 수
  issuesFound: 'number', // 발견된 문제 수
  riskLevel: 'string', // CRITICAL, HIGH, MEDIUM, LOW

  // 상세 결과
  findings: 'list' // 발견된 문제들
};

module.exports = {
  tableName: 'InspectionItemResults',
  schema: InspectionItemResultSchema,

  // DynamoDB 테이블 생성 스크립트 (최적화됨)
  createTableParams: {
    TableName: 'InspectionItemResults',
    KeySchema: [
      { AttributeName: 'customerId', KeyType: 'HASH' },
      { AttributeName: 'itemKey', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'customerId', AttributeType: 'S' },
      { AttributeName: 'itemKey', AttributeType: 'S' },
      { AttributeName: 'serviceType', AttributeType: 'S' },
      { AttributeName: 'inspectionTime', AttributeType: 'N' },
      { AttributeName: 'inspectionId', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        // 서비스별 조회용 (선택적)
        IndexName: 'customerId-serviceType-index',
        KeySchema: [
          { AttributeName: 'customerId', KeyType: 'HASH' },
          { AttributeName: 'serviceType', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      },
      {
        // 시간순 조회용 (전체 검사 히스토리)
        IndexName: 'customerId-inspectionTime-index',
        KeySchema: [
          { AttributeName: 'customerId', KeyType: 'HASH' },
          { AttributeName: 'inspectionTime', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      },
      {
        // 검사 ID별 조회용 (특정 검사의 모든 항목)
        IndexName: 'customerId-inspectionId-index',
        KeySchema: [
          { AttributeName: 'customerId', KeyType: 'HASH' },
          { AttributeName: 'inspectionId', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' },
        BillingMode: 'PAY_PER_REQUEST'
      }
    ],
    BillingMode: 'PAY_PER_REQUEST'
  },

  // itemKey 생성 헬퍼 함수들
  helpers: {
    /**
     * LATEST 아이템 키 생성
     * @param {string} serviceType - 서비스 타입 (EC2, S3, IAM)
     * @param {string} itemId - 항목 ID (dangerous_ports, bucket_encryption)
     * @returns {string} LATEST 아이템 키
     */
    createLatestKey(serviceType, itemId) {
      return `LATEST#${serviceType}#${itemId}`;
    },

    /**
     * HISTORY 아이템 키 생성 (시간순 정렬)
     * @param {string} serviceType - 서비스 타입
     * @param {string} itemId - 항목 ID
     * @param {number} timestamp - 검사 시간 (역순 정렬을 위해 변환)
     * @param {string} inspectionId - 검사 ID
     * @returns {string} HISTORY 아이템 키
     */
    createHistoryKey(serviceType, itemId, timestamp, inspectionId) {
      // 시간 역순 정렬을 위해 timestamp를 뒤집음 (최신이 먼저 오도록)
      const reversedTimestamp = (9999999999999 - timestamp).toString().padStart(13, '0');
      return `HISTORY#${serviceType}#${itemId}#${reversedTimestamp}#${inspectionId}`;
    },

    /**
     * itemKey에서 정보 추출
     * @param {string} itemKey - 아이템 키
     * @returns {Object} 파싱된 정보
     */
    parseItemKey(itemKey) {
      const parts = itemKey.split('#');
      const recordType = parts[0]; // LATEST 또는 HISTORY

      if (recordType === 'LATEST') {
        return {
          recordType: 'LATEST',
          serviceType: parts[1],
          itemId: parts[2]
        };
      } else if (recordType === 'HISTORY') {
        const reversedTimestamp = parseInt(parts[3]);
        const originalTimestamp = 9999999999999 - reversedTimestamp;

        return {
          recordType: 'HISTORY',
          serviceType: parts[1],
          itemId: parts[2],
          timestamp: originalTimestamp,
          inspectionId: parts[4]
        };
      }

      throw new Error(`Invalid itemKey format: ${itemKey}`);
    }
  }
};