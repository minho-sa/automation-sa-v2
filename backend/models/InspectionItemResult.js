/**
 * 검사 항목별 결과 모델 (최적화된 구조)
 * recordType 기반 정렬키로 LATEST/HISTORY 효율적 조회
 */

const InspectionItemResultSchema = {
  // Primary Key
  customerId: 'string', // 고객 ID (HASH) - 사용자별 파티션
  itemKey: 'string', // 아이템 식별키 (RANGE) - Latest 빠른 조회용

  // itemKey 구조 (최적화됨):
  // LATEST: "LATEST#{serviceType}#{region}"
  // HISTORY: "HISTORY#{serviceType}#{region}#{timestamp}"
  // itemId는 별도 필드로 분리

  // 핵심 데이터
  serviceType: 'string', // EC2, RDS, S3, IAM - 서비스별 분류
  itemId: 'string', // dangerous-ports, bucket-encryption 등 - 프론트엔드에서 카테고리 매핑
  region: 'string', // AWS 리전 (us-east-1, ap-northeast-2 등)
  findings: 'list', // 발견된 문제 배열 - 핵심 데이터

  // 메타데이터
  inspectionId: 'string', // 검사 ID (HISTORY 레코드만)
  inspectionTime: 'number' // 검사 시간 (Unix timestamp)

  // 제거된 필드들 (프론트엔드에서 계산):
  // - category: inspectionItems.js에서 itemId 기반으로 매핑
  // - issuesFound: findings.length로 계산
  // - status: findings 유무 + baseSeverity로 결정
  // - totalResources: 실제 사용되지 않음
  // - score: 복잡한 점수 계산 불필요
  // - summary: 프론트엔드에서 생성
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
     * @param {string} itemId - 항목 ID
     * @param {string} region - AWS 리전
     * @returns {string} LATEST 아이템 키
     */
    createLatestKey(serviceType, itemId, region = 'us-east-1') {
      return `LATEST#${serviceType}#${region}#${itemId}`;
    },

    /**
     * HISTORY 아이템 키 생성
     * @param {number} timestamp - 검사 시간
     * @param {string} serviceType - 서비스 타입
     * @param {string} inspectionId - 검사 ID
     * @returns {string} HISTORY 아이템 키
     */
    createHistoryKey(timestamp, serviceType, inspectionId) {
      return `HISTORY#${timestamp}#${serviceType}#${inspectionId}`;
    },

    /**
     * itemKey에서 정보 추출 (간소화된 구조)
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
          region: parts[2],
          itemId: parts[3]
        };
      } else if (recordType === 'HISTORY') {
        return {
          recordType: 'HISTORY',
          timestamp: parseInt(parts[1]),
          serviceType: parts[2],
          inspectionId: parts[3]
        };
      }

      throw new Error(`Invalid itemKey format: ${itemKey}`);
    }
  }
};