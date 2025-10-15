const {
  PutCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
// .env 파일 로드 확인
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { dynamoDBDocClient } = require('../config/aws');

/**
 * History Service (최적화됨)
 * DynamoDB를 사용한 검사 이력 관리 서비스
 * 
 * 핵심 기능만 유지:
 * - 검사 이력 저장 및 조회
 * - 최신 검사 결과 조회
 * - 항목별 검사 이력 조회
 */
class HistoryService {
  // 페이지네이션 설정 - 여기서만 수정하면 됨
  static DEFAULT_PAGE_SIZE = 10;
  constructor() {
    this.client = dynamoDBDocClient;
    // 단일 테이블 구조: InspectionItemResults 테이블만 사용
    this.tableName = process.env.AWS_DYNAMODB_INSPECTION_ITEMS_TABLE || 'InspectionItemResults';
  }

  /**
   * 검사 이력 저장
   * @param {Object} inspectionData - 검사 데이터
   * @returns {Promise<Object>} 저장 결과
   */
  async saveInspectionHistory(inspectionData) {
    try {
      const inspectionId = inspectionData.inspectionId;
      if (!inspectionId) {
        throw new Error('inspectionId is required');
      }

      const timestamp = Date.now();

      // 검사 결과에 따라 상태 결정
      const findings = inspectionData.results.findings || [];
      const status = findings.length > 0 ? 'FAILED' : 'COMPLETED';

      const historyRecord = {
        customerId: inspectionData.customerId,
        inspectionId,
        serviceType: inspectionData.serviceType,
        status: status,
        startTime: inspectionData.startTime || timestamp,
        endTime: inspectionData.endTime || timestamp,
        duration: inspectionData.duration || 0,
        timestamp,
        results: {
          summary: inspectionData.results.summary || {},
          findings: inspectionData.results.findings || []
        },
        assumeRoleArn: inspectionData.assumeRoleArn,
        metadata: {
          version: '1.0',
          inspectorVersion: inspectionData.metadata?.inspectorVersion || 'unknown',
          ...inspectionData.metadata
        }
      };

      const params = {
        TableName: this.tableName,
        Item: historyRecord
      };

      const command = new PutCommand(params);
      await this.client.send(command);

      return {
        success: true,
        inspectionId,
        data: historyRecord
      };
    } catch (error) {
      console.error('검사 이력 저장 실패:', error);
      throw new Error(`검사 이력 저장 실패: ${error.message}`);
    }
  }





  /**
   * 검사 이력 조회 (단순화된 메서드)
   * @param {string} customerId - 고객 ID
   * @param {Object} options - 조회 옵션
   * @returns {Promise<Object>} 검사 이력 목록
   */
  async getInspectionHistory(customerId, options = {}) {
    try {
      const {
        serviceType,
        historyMode = 'history',
        lastEvaluatedKey,
        aggregated = false
      } = options;

      const limit = HistoryService.DEFAULT_PAGE_SIZE;
      const itemKeyPrefix = historyMode === 'latest' ? 'LATEST#' : 'HISTORY#';

      let keyConditionExpression = 'customerId = :customerId';
      const expressionAttributeValues = {
        ':customerId': customerId
      };

      // 서비스 타입 필터
      if (serviceType && serviceType !== 'all') {
        keyConditionExpression += ' AND begins_with(itemKey, :itemKeyPrefix)';
        expressionAttributeValues[':itemKeyPrefix'] = `${itemKeyPrefix}${serviceType}#`;
      } else {
        keyConditionExpression += ' AND begins_with(itemKey, :itemKeyPrefix)';
        expressionAttributeValues[':itemKeyPrefix'] = itemKeyPrefix;
      }

      const params = {
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false,
        Limit: limit
      };

      // 페이지네이션
      if (lastEvaluatedKey) {
        try {
          params.ExclusiveStartKey = typeof lastEvaluatedKey === 'string'
            ? JSON.parse(lastEvaluatedKey)
            : lastEvaluatedKey;
        } catch (parseError) {
          console.warn('⚠️ Invalid lastEvaluatedKey format:', parseError.message);
        }
      }

      // 최신 결과용 consistent read
      if (historyMode === 'latest') {
        params.ConsistentRead = true;
      }

      const command = new QueryCommand(params);
      const result = await this.client.send(command);

      if (!result.Items || result.Items.length === 0) {
        return {
          success: true,
          data: historyMode === 'latest'
            ? { services: {} }
            : { items: [], count: 0, hasMore: false, lastEvaluatedKey: null }
        };
      }

      // 최신 결과는 서비스별로 그룹화 (전체 정보 포함)
      if (historyMode === 'latest') {
        const services = {};
        result.Items.forEach(item => {
          const serviceType = item.serviceType;
          if (!services[serviceType]) {
            services[serviceType] = {};
          }

          const { helpers } = require('../models/InspectionItemResult');
          let itemId;
          try {
            const parsed = helpers.parseItemKey(item.itemKey);
            itemId = parsed.itemId;
          } catch (error) {
            itemId = item.itemId || 'unknown';
          }

          const findings = item.findings || [];
          services[serviceType][itemId] = {
            inspectionTime: item.inspectionTime,
            inspectionId: item.inspectionId || item.lastInspectionId,
            // 요약 정보
            issueCount: findings.length,
            hasIssues: findings.length > 0,
            status: findings.length > 0 ? 'FAILED' : 'PASSED',
            // 전체 상세 정보 (어차피 동일한 RCU)
            findings: findings,
            // 추가 메타데이터
            category: item.category,
            itemId: itemId,
            serviceType: serviceType
          };
        });

        return {
          success: true,
          data: { services }
        };
      }

      // 집계된 검사 결과 요청 시
      if (aggregated) {
        const inspectionGroups = {};
        result.Items.forEach(item => {
          const inspectionId = item.inspectionId;
          if (!inspectionGroups[inspectionId]) {
            inspectionGroups[inspectionId] = [];
          }
          inspectionGroups[inspectionId].push(item);
        });

        const inspections = Object.keys(inspectionGroups).map(inspectionId => {
          const items = inspectionGroups[inspectionId];
          if (!items || items.length === 0) return null;

          const firstItem = items[0];
          const allFindings = [];
          let totalResources = 0;

          items.forEach(item => {
            if (item.findings && Array.isArray(item.findings)) {
              allFindings.push(...item.findings);
            }
            totalResources += item.resourcesScanned || 1;
          });

          return {
            inspectionId,
            customerId: firstItem.customerId,
            serviceType: firstItem.serviceType,
            status: 'COMPLETED',
            startTime: firstItem.inspectionTime,
            endTime: firstItem.inspectionTime,
            duration: firstItem.duration || 0,
            results: {
              summary: { totalResources, highRiskIssues: 0, mediumRiskIssues: 0, lowRiskIssues: 0 },
              findings: allFindings
            },
            assumeRoleArn: firstItem.assumeRoleArn,
            metadata: { version: '1.0', itemCount: items.length }
          };
        }).filter(inspection => inspection !== null);

        return {
          success: true,
          data: {
            inspections,
            count: inspections.length,
            hasMore: !!result.LastEvaluatedKey,
            lastEvaluatedKey: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : null
          }
        };
      }

      // 기본: raw 항목 데이터 반환
      return {
        success: true,
        data: {
          items: result.Items,
          count: result.Items.length,
          hasMore: !!result.LastEvaluatedKey,
          lastEvaluatedKey: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : null
        }
      };
    } catch (error) {
      console.error('❌ [HistoryService] 검사 이력 조회 실패:', error);
      throw new Error(`검사 이력 조회 실패: ${error.message}`);
    }
  }






}

module.exports = new HistoryService();