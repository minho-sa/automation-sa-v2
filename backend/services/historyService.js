const {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
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
      const isoTimestamp = new Date().toISOString();

      // 검사 결과에 따라 상태 결정
      const findings = inspectionData.results.findings || [];
      const status = this.determineInspectionStatus(findings);

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
   * 특정 검사 이력 조회
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID
   * @returns {Promise<Object>} 검사 이력
   */
  async getInspectionHistory(customerId, inspectionId) {
    try {
      const params = {
        TableName: this.tableName,
        KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :history)',
        FilterExpression: 'inspectionId = :inspectionId',
        ExpressionAttributeValues: {
          ':customerId': customerId,
          ':inspectionId': inspectionId,
          ':history': 'HISTORY#'
        }
      };

      const command = new QueryCommand(params);
      const result = await this.client.send(command);

      if (!result.Items || result.Items.length === 0) {
        return {
          success: false,
          error: '검사 이력을 찾을 수 없습니다'
        };
      }

      const inspectionData = this.aggregateInspectionResults(result.Items, inspectionId);

      return {
        success: true,
        data: inspectionData
      };
    } catch (error) {
      console.error('❌ [HistoryService] 검사 이력 조회 실패:', error);
      throw new Error(`검사 이력 조회 실패: ${error.message}`);
    }
  }

  /**
   * 고객별 검사 이력 목록 조회
   * @param {string} customerId - 고객 ID
   * @param {Object} options - 조회 옵션
   * @returns {Promise<Object>} 검사 이력 목록
   */
  async getInspectionHistoryList(customerId, options = {}) {
    try {
      const { limit = 20, serviceType } = options;

      let keyConditionExpression = 'customerId = :customerId AND begins_with(itemKey, :history)';
      let filterExpression = '';
      const expressionAttributeValues = {
        ':customerId': customerId,
        ':history': 'HISTORY#'
      };

      // 서비스 타입 필터 추가
      if (serviceType && serviceType !== 'all') {
        filterExpression += ' AND serviceType = :serviceType';
        expressionAttributeValues[':serviceType'] = serviceType;
      }

      const params = {
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues
      };

      if (filterExpression) {
        params.FilterExpression = filterExpression;
      }

      const command = new QueryCommand(params);
      const result = await this.client.send(command);

      if (!result.Items || result.Items.length === 0) {
        return {
          success: true,
          data: {
            inspections: [],
            count: 0,
            hasMore: false
          }
        };
      }

      // 검사 ID별로 그룹화
      const inspectionGroups = {};
      result.Items.forEach(item => {
        const inspectionId = item.inspectionId;
        if (!inspectionGroups[inspectionId]) {
          inspectionGroups[inspectionId] = [];
        }
        inspectionGroups[inspectionId].push(item);
      });

      // 각 검사별로 집계된 결과 생성
      const inspections = Object.keys(inspectionGroups).map(inspectionId => {
        const items = inspectionGroups[inspectionId];
        return this.aggregateInspectionResults(items, inspectionId);
      }).filter(inspection => inspection !== null);

      // 최신순으로 정렬
      inspections.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

      // 제한 수만큼 자르기
      const limitedInspections = inspections.slice(0, limit);

      return {
        success: true,
        data: {
          inspections: limitedInspections,
          count: limitedInspections.length,
          hasMore: inspections.length > limit
        }
      };
    } catch (error) {
      console.error('❌ [HistoryService] 검사 이력 목록 조회 실패:', error);
      throw new Error(`검사 이력 목록 조회 실패: ${error.message}`);
    }
  }

  /**
   * 항목별 검사 이력 조회
   * @param {string} customerId - 고객 ID
   * @param {Object} options - 조회 옵션
   * @returns {Promise<Object>} 항목별 검사 이력 목록
   */
  async getItemInspectionHistory(customerId, options = {}) {
    try {
      const { limit = 50, serviceType, startDate, endDate, status, historyMode = 'history' } = options;

      // KeyConditionExpression 구성
      let keyConditionExpression = 'customerId = :customerId';
      const expressionAttributeValues = {
        ':customerId': customerId
      };

      // 히스토리 모드에 따라 itemKey 패턴 결정
      const itemKeyPrefix = historyMode === 'latest' ? 'LATEST#' : 'HISTORY#';
      
      // 서비스 타입 필터가 있으면 더 구체적인 패턴 사용
      if (serviceType && serviceType !== 'all') {
        keyConditionExpression += ' AND begins_with(itemKey, :itemKeyPrefix)';
        expressionAttributeValues[':itemKeyPrefix'] = `${itemKeyPrefix}${serviceType}#`;
      } else {
        keyConditionExpression += ' AND begins_with(itemKey, :itemKeyPrefix)';
        expressionAttributeValues[':itemKeyPrefix'] = itemKeyPrefix;
      }

      // FilterExpression 구성
      let filterExpression = '';
      const filterConditions = [];

      // 날짜 필터 추가
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

      // 상태 필터 추가
      if (status && status !== 'all') {
        // 검사 항목별 상태로 통일 매핑
        const mappedStatus = this.mapToItemStatus(status);
        filterConditions.push('#status = :status');
        expressionAttributeValues[':status'] = mappedStatus;
      }

      if (filterConditions.length > 0) {
        filterExpression = filterConditions.join(' AND ');
      }

      const params = {
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false, // 최신순 정렬
        Limit: limit
      };

      if (filterExpression) {
        params.FilterExpression = filterExpression;
      }

      // status는 DynamoDB 예약어이므로 ExpressionAttributeNames 사용
      if (status && status !== 'all') {
        params.ExpressionAttributeNames = {
          '#status': 'status'
        };
      }

      const command = new QueryCommand(params);
      const result = await this.client.send(command);

      if (!result.Items || result.Items.length === 0) {
        return {
          success: true,
          data: {
            items: [],
            count: 0
          }
        };
      }

      return {
        success: true,
        data: {
          items: result.Items,
          count: result.Items.length,
          hasMore: !!result.LastEvaluatedKey,
          lastEvaluatedKey: result.LastEvaluatedKey
        }
      };
    } catch (error) {
      console.error('❌ [HistoryService] 항목별 검사 이력 조회 실패:', error);
      throw new Error(`항목별 검사 이력 조회 실패: ${error.message}`);
    }
  }

  /**
   * 최신 검사 결과 조회 (리소스 검사 탭용)
   * @param {string} customerId - 고객 ID
   * @param {string} serviceType - 서비스 타입 (선택사항)
   * @returns {Promise<Object>} 최신 검사 결과들
   */
  async getLatestInspectionResults(customerId, serviceType = null) {
    try {
      console.log(`🔍 [HistoryService] Getting latest results for customer ${customerId}, service: ${serviceType || 'ALL'}`);

      let keyConditionExpression = 'customerId = :customerId AND begins_with(itemKey, :latest)';
      let filterExpression = '';
      const expressionAttributeValues = {
        ':customerId': customerId,
        ':latest': 'LATEST#'
      };

      // 서비스 타입 필터 추가
      if (serviceType) {
        filterExpression += ' AND serviceType = :serviceType';
        expressionAttributeValues[':serviceType'] = serviceType;
      }

      const params = {
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ConsistentRead: true
      };

      if (filterExpression) {
        params.FilterExpression = filterExpression;
      }

      console.log(`🔍 [HistoryService] Querying with params:`, {
        tableName: this.tableName,
        keyConditionExpression,
        filterExpression,
        consistentRead: true
      });

      const command = new QueryCommand(params);
      const result = await this.client.send(command);

      console.log(`🔍 [HistoryService] Query result:`, {
        itemCount: result.Items?.length || 0,
        scannedCount: result.ScannedCount,
        consumedCapacity: result.ConsumedCapacity
      });

      const groupedServices = this.groupItemsByService(result.Items || []);

      console.log(`🔍 [HistoryService] Grouped services:`, {
        serviceTypes: Object.keys(groupedServices),
        totalItems: Object.values(groupedServices).reduce((sum, service) => sum + Object.keys(service).length, 0)
      });

      return {
        success: true,
        data: {
          services: groupedServices
        }
      };
    } catch (error) {
      console.error('❌ [HistoryService] 최신 검사 결과 조회 실패:', error);
      throw new Error(`최신 검사 결과 조회 실패: ${error.message}`);
    }
  }

  // ========== 헬퍼 메서드들 ==========

  /**
   * 검사 항목들을 집계하여 전체 검사 결과로 변환
   */
  aggregateInspectionResults(items, inspectionId) {
    if (!items || items.length === 0) {
      return null;
    }

    const firstItem = items[0];
    const allFindings = [];
    let totalResources = 0;
    let highRiskIssues = 0;
    let mediumRiskIssues = 0;
    let lowRiskIssues = 0;

    items.forEach(item => {
      if (item.findings && Array.isArray(item.findings)) {
        allFindings.push(...item.findings);
      }
      
      if (item.findings) {
        // 새로운 시스템에서는 findings 개수만 카운트
        // severity는 검사 항목 레벨에서 결정됨
      }
      
      totalResources += item.resourcesScanned || 1;
    });

    return {
      inspectionId: inspectionId,
      customerId: firstItem.customerId,
      serviceType: firstItem.serviceType,
      status: 'COMPLETED',
      startTime: firstItem.inspectionTime,
      endTime: firstItem.inspectionTime,
      duration: firstItem.duration || 0,
      results: {
        summary: {
          totalResources,
          highRiskIssues,
          mediumRiskIssues,
          lowRiskIssues
        },
        findings: allFindings
      },
      assumeRoleArn: firstItem.assumeRoleArn,
      metadata: {
        version: '1.0',
        itemCount: items.length
      }
    };
  }

  /**
   * 검사 항목들을 서비스별로 그룹화
   */
  groupItemsByService(items) {
    const services = {};
    
    items.forEach(item => {
      const serviceType = item.serviceType;
      if (!services[serviceType]) {
        services[serviceType] = {};
      }
      
      // itemKey에서 itemId 추출
      const { helpers } = require('../models/InspectionItemResult');
      let itemId;
      
      try {
        const parsed = helpers.parseItemKey(item.itemKey);
        itemId = parsed.itemId;
      } catch (error) {
        itemId = item.itemId || 'unknown';
      }
      
      services[serviceType][itemId] = {
        // status 필드 제거 - 프론트엔드에서 findings 기반으로 계산
        inspectionTime: item.inspectionTime,
        inspectionId: item.inspectionId || item.lastInspectionId,
        findings: item.findings || []
      };
    });
    return services;
  }

  /**
   * 검사 결과에 따라 상태 결정
   */
  determineInspectionStatus(findings) {
    if (!findings || findings.length === 0) {
      return 'COMPLETED';
    }

    // 새로운 시스템: findings가 있으면 FAILED, 없으면 COMPLETED
    if (findings.length > 0) {
      return 'FAILED';
    } else {
      return 'COMPLETED';
    }
  }

  /**
   * 전체 검사 상태를 검사 항목별 상태로 매핑
   * @param {string} status - 전체 검사 상태 (PENDING, IN_PROGRESS, COMPLETED, FAILED)
   * @returns {string} 검사 항목별 상태 (PASS, FAIL, WARNING, NOT_CHECKED)
   */
  mapToItemStatus(status) {
    const statusMapping = {
      'COMPLETED': 'PASS',
      'FAILED': 'FAIL', 
      'PENDING': 'NOT_CHECKED',
      'IN_PROGRESS': 'NOT_CHECKED',
      // 이미 검사 항목별 상태인 경우 그대로 반환
      'PASS': 'PASS',
      'FAIL': 'FAIL',
      'WARNING': 'WARNING',
      'NOT_CHECKED': 'NOT_CHECKED'
    };
    
    return statusMapping[status] || status;
  }
}

module.exports = new HistoryService();