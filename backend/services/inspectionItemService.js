const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// 환경변수 로드
require('dotenv').config();

/**
 * 검사 항목별 결과 관리 서비스
 * AWS Trusted Advisor 스타일의 항목별 상태 관리
 */
class InspectionItemService {
  constructor() {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1'
    }));
    this.tableName = process.env.AWS_DYNAMODB_INSPECTION_ITEMS_TABLE || 'InspectionItemResults';
  }

  /**
   * 검사 항목별 결과 저장/업데이트
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID
   * @param {Object} itemResult - 검사 항목 결과
   */
  async saveItemResult(customerId, inspectionId, itemResult) {
    try {
      const now = Date.now();

      // 공통 아이템 데이터
      const baseItem = {
        customerId,
        serviceType: itemResult.serviceType,
        itemId: itemResult.itemId,
        category: itemResult.category,

        // 기존 필드명 제거됨 - inspectionId, inspectionTime으로 대체
        status: this.determineStatus(itemResult),

        totalResources: itemResult.totalResources || 0,
        issuesFound: itemResult.issuesFound || 0,
        summary: itemResult.summary || { findingsCount: 0 },
        score: itemResult.score || 100,

        findings: itemResult.findings || []
      };

      // Helper 함수 import
      const { helpers } = require('../models/InspectionItemResult');

      // 1. 히스토리용 레코드 저장 (검사 ID 포함, 시간순 정렬)
      const historyKey = helpers.createHistoryKey(
        itemResult.serviceType,
        itemResult.itemId,
        now,
        inspectionId
      );

      const historyItem = {
        ...baseItem,
        itemKey: historyKey,
        inspectionId: inspectionId,
        inspectionTime: now
      };

      // 2. 최신 상태용 레코드 저장/업데이트 (LATEST)
      const latestKey = helpers.createLatestKey(itemResult.serviceType, itemResult.itemId);
      const latestItem = {
        ...baseItem,
        itemKey: latestKey,
        inspectionTime: now
      };

      // 두 레코드 모두 저장
      await Promise.all([
        this.client.send(new PutCommand({
          TableName: this.tableName,
          Item: historyItem
        })),
        this.client.send(new PutCommand({
          TableName: this.tableName,
          Item: latestItem
        }))
      ]);

      console.log(`✅ [InspectionItemService] Saved both LATEST and HISTORY records:`, {
        historyKey: historyItem.itemKey,
        latestKey: latestItem.itemKey
      });

      return { success: true, data: { historyItem, latestItem } };

    } catch (error) {
      console.error('Failed to save item result:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 서비스별 최근 검사 항목 결과 조회
   * @param {string} customerId - 고객 ID
   * @param {string} serviceType - 서비스 타입 (EC2, RDS, S3, IAM)
   */
  async getServiceItemResults(customerId, serviceType) {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'customerId-serviceType-index',
        KeyConditionExpression: 'customerId = :customerId AND serviceType = :serviceType',
        ExpressionAttributeValues: {
          ':customerId': customerId,
          ':serviceType': serviceType
        },
        ScanIndexForward: false // 최신순 정렬
      });

      const result = await this.client.send(command);
      return {
        success: true,
        data: result.Items || []
      };

    } catch (error) {
      console.error('Failed to get service item results:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 모든 서비스의 최근 검사 항목 결과 조회 (LATEST만)
   * @param {string} customerId - 고객 ID
   */
  async getAllItemResults(customerId) {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :latest)',
        ExpressionAttributeValues: {
          ':customerId': customerId,
          ':latest': 'LATEST#'
        }
      });

      const result = await this.client.send(command);

      console.log(`🔍 [InspectionItemService] Found ${result.Items?.length || 0} LATEST item results`);

      // 서비스별로 그룹화
      const groupedResults = {};
      (result.Items || []).forEach(item => {
        if (!groupedResults[item.serviceType]) {
          groupedResults[item.serviceType] = [];
        }
        groupedResults[item.serviceType].push(item);
      });

      return {
        success: true,
        data: groupedResults
      };

    } catch (error) {
      console.error('Failed to get all item results:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 특정 검사 항목의 상세 결과 조회 (LATEST 레코드)
   * @param {string} customerId - 고객 ID
   * @param {string} serviceType - 서비스 타입
   * @param {string} itemId - 검사 항목 ID
   */
  async getItemResult(customerId, serviceType, itemId) {
    try {
      // Helper 함수 import
      const { helpers } = require('../models/InspectionItemResult');
      const itemKey = helpers.createLatestKey(serviceType, itemId);

      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          customerId,
          itemKey
        }
      });

      const result = await this.client.send(command);

      if (!result.Item) {
        return {
          success: false,
          error: 'Item result not found'
        };
      }

      return {
        success: true,
        data: result.Item
      };

    } catch (error) {
      console.error('Failed to get item result:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 고객의 모든 검사 항목 히스토리 조회 (시간순 정렬)
   * @param {string} customerId - 고객 ID
   * @param {Object} options - 조회 옵션
   */
  async getItemHistory(customerId, options = {}) {
    try {
      const { serviceType, limit = 50, startDate, endDate } = options;

      console.log(`🔍 [InspectionItemService] Getting item history for customer: ${customerId}`);
      console.log(`🔍 [InspectionItemService] Options:`, { serviceType, limit, startDate, endDate });

      let queryParams = {
        TableName: this.tableName,
        KeyConditionExpression: 'customerId = :customerId AND begins_with(itemKey, :history)',
        ExpressionAttributeValues: {
          ':customerId': customerId,
          ':history': serviceType ? `HISTORY#${serviceType}#` : 'HISTORY#'
        },
        ScanIndexForward: true // itemKey에 이미 시간 역순이 적용되어 있음
      };

      // 서비스 타입 필터가 있는 경우 GSI 사용
      if (serviceType) {
        queryParams.IndexName = 'customerId-serviceType-index';
        queryParams.KeyConditionExpression = 'customerId = :customerId AND serviceType = :serviceType';
        queryParams.ExpressionAttributeValues[':serviceType'] = serviceType;
      }

      // 날짜 필터가 있는 경우 FilterExpression 추가
      if (startDate || endDate) {
        let filterExpressions = [];

        if (startDate) {
          filterExpressions.push('lastInspectionTime >= :startDate');
          queryParams.ExpressionAttributeValues[':startDate'] = new Date(startDate).getTime();
        }

        if (endDate) {
          filterExpressions.push('lastInspectionTime <= :endDate');
          queryParams.ExpressionAttributeValues[':endDate'] = new Date(endDate).getTime();
        }

        if (filterExpressions.length > 0) {
          queryParams.FilterExpression = filterExpressions.join(' AND ');
        }
      }

      if (limit) {
        queryParams.Limit = parseInt(limit);
      }

      const command = new QueryCommand(queryParams);
      const result = await this.client.send(command);

      console.log(`🔍 [InspectionItemService] Found ${result.Items?.length || 0} item history records`);

      // 각 항목의 itemKey 구조 확인
      if (result.Items && result.Items.length > 0) {
        console.log('🔍 [InspectionItemService] Sample itemKeys:');
        result.Items.slice(0, 3).forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.itemKey} - ${item.itemId} (${new Date(item.inspectionTime || item.lastInspectionTime).toLocaleString()})`);
        });
      }

      // 시간순으로 정렬 (DynamoDB 쿼리 결과를 추가로 정렬)
      const sortedItems = (result.Items || []).sort((a, b) =>
        (b.lastInspectionTime || 0) - (a.lastInspectionTime || 0)
      );

      return {
        success: true,
        data: sortedItems,
        count: result.Count || 0,
        hasMore: !!result.LastEvaluatedKey
      };

    } catch (error) {
      console.error('Failed to get item history:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 검사 결과를 기반으로 상태 결정
   * @param {Object} itemResult - 검사 항목 결과
   * @returns {string} 상태 (PASS, FAIL, WARNING, NOT_CHECKED)
   */
  determineStatus(itemResult) {
    if (!itemResult.totalResources || itemResult.totalResources === 0) {
      return 'NOT_CHECKED';
    }

    const issuesFound = itemResult.issuesFound || 0;
    // 단순화: findings가 있으면 FAIL, 없으면 PASS
    if (issuesFound === 0) {
      return 'PASS';
    }

    return 'FAIL';

    return 'WARNING';
  }

  /**
   * 검사 완료 시 전체 결과를 항목별로 분해하여 저장
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID
   * @param {Object} inspectionResult - 전체 검사 결과
   */
  async processInspectionResult(customerId, inspectionId, inspectionResult) {
    try {
      const { serviceType, results, metadata } = inspectionResult;

      if (!results || !results.findings) {
        return { success: true, message: 'No findings to process' };
      }

      // 개별 항목 검사인 경우 해당 항목으로만 분류
      if (metadata && metadata.targetItem && metadata.targetItem !== 'all') {
        const targetItemId = metadata.targetItem;

        // 모든 findings를 해당 항목으로 분류
        const itemResult = {
          serviceType,
          itemId: targetItemId,
          // itemName 제거 - 프론트엔드에서 매핑
          category: 'security', // 기본 카테고리
          totalResources: results.findings.length,
          issuesFound: results.findings.length,
          summary: this.createItemSummary(results.findings),
          findings: results.findings
        };

        await this.saveItemResult(customerId, inspectionId, itemResult);

        return {
          success: true,
          message: `Processed single inspection item: ${targetItemId}`
        };
      }

      // 전체 검사인 경우 기존 로직 사용
      const itemResults = this.categorizeFindings(serviceType, results.findings);

      // 각 항목별 결과 저장
      const savePromises = Object.entries(itemResults).map(([itemId, itemData]) => {
        return this.saveItemResult(customerId, inspectionId, {
          serviceType,
          itemId,
          category: itemData.category,
          totalResources: itemData.totalResources,
          issuesFound: itemData.findings.length,
          summary: this.createItemSummary(itemData.findings),
          score: itemData.score,
          findings: itemData.findings,
          recommendations: itemData.recommendations
        });
      });

      await Promise.all(savePromises);

      return {
        success: true,
        message: `Processed ${Object.keys(itemResults).length} inspection items`
      };

    } catch (error) {
      console.error('Failed to process inspection result:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 검사 결과를 항목별로 분류
   * @param {string} serviceType - 서비스 타입
   * @param {Array} findings - 검사 결과
   * @returns {Object} 항목별 분류된 결과
   */
  categorizeFindings(serviceType, findings) {
    const itemResults = {};

    // 서비스별 카테고리 매핑만 관리 (이름은 프론트엔드에서 매핑)
    const categoryMappings = {
      EC2: {
        'dangerous-ports': 'security',
        'ebs-encryption': 'security',
        'ebs-volume-version': 'performance',
        'termination-protection': 'security',
        'unused-security-groups': 'cost-optimization',
        'unused-elastic-ip': 'cost-optimization',
        'old-snapshots': 'cost-optimization',
        'stopped-instances': 'cost-optimization',
        // 레거시
        'security_groups': 'security',
        'key_pairs': 'security',
        'instance_metadata': 'security',
        'instance_types': 'performance',
        'ebs_optimization': 'performance'
      },
      RDS: {
        'encryption': 'security',
        'security_groups': 'security',
        'public_access': 'security',
        'automated_backup': 'backup',
        'snapshot_encryption': 'backup'
      },
      S3: {
        'bucket-encryption': 'security',
        'bucket-public-access': 'security',
        'bucket-policy': 'security',
        'bucket-cors': 'security',
        'bucket-versioning': 'data-protection',
        'bucket-logging': 'data-protection',
        'bucket-lifecycle': 'cost-optimization',
        // 레거시
        'bucket_policy': 'security',
        'public_access': 'security',
        'encryption': 'security',
        'versioning': 'compliance'
      },
      IAM: {
        'root-access-key': 'security',
        'mfa-enabled': 'security',
        'unused-credentials': 'security',
        'overprivileged-user-policies': 'policies',
        'overprivileged-role-policies': 'policies',
        'inline-policies': 'policies',
        'unused-policies': 'policies',
        // 레거시
        'root_access_key': 'security',
        'mfa_enabled': 'security',
        'unused_credentials': 'security'
      }
    };

    const categories = categoryMappings[serviceType] || {};

    // 각 finding을 적절한 항목으로 분류
    findings.forEach(finding => {
      const itemId = this.determineItemId(finding);

      if (!itemResults[itemId]) {
        const category = categories[itemId] || 'security';
        
        itemResults[itemId] = {
          // name 제거 - 프론트엔드에서 매핑
          category: category,
          totalResources: 0,
          findings: []
        };
      }

      itemResults[itemId].findings.push(finding);
      itemResults[itemId].totalResources++;

      // riskLevel 제거 - 새로운 시스템에서는 검사 항목의 severity를 상속

      // 점수 계산 (간단한 로직)
      itemResults[itemId].score = Math.max(0, itemResults[itemId].score - (finding.riskScore || 10));
    });

    return itemResults;
  }

  /**
   * Finding에서 검사 항목 ID 결정
   * @param {Object} finding - 검사 결과
   * @returns {string} 항목 ID
   */
  determineItemId(finding) {
    // 간단한 키워드 매칭으로 항목 결정
    const issue = finding.issue?.toLowerCase() || '';

    if (issue.includes('security group')) return 'security_groups';
    if (issue.includes('key pair')) return 'key_pairs';
    if (issue.includes('metadata')) return 'instance_metadata';
    if (issue.includes('encryption')) return 'encryption';
    if (issue.includes('backup')) return 'automated_backup';
    if (issue.includes('bucket policy')) return 'bucket_policy';
    if (issue.includes('public access')) return 'public_access';
    if (issue.includes('root')) return 'root_access_key';
    if (issue.includes('mfa')) return 'mfa_enabled';

    return 'other';
  }

  /**
   * 검사 항목 결과 요약 생성 - 단순화
   * @param {Array} findings - 검사 결과 배열
   * @returns {Object} 검사 항목 결과 요약
   */
  createItemSummary(findings) {
    return {
      findingsCount: findings.length,
      resourcesAffected: [...new Set(findings.map(f => f.resourceId))].length
    };
  }

  /**
   * 점수 계산
   * @param {Array} findings - 검사 결과 목록
   * @returns {number} 점수 (0-100)
   */
  calculateScore(findings) {
    let score = 100;
    findings.forEach(finding => {
      score = Math.max(0, score - (finding.riskScore || 10));
    });
    return score;
  }

  // severity 관련 메서드 제거 - 프론트엔드에서만 처리
}

module.exports = new InspectionItemService();