const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

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

      // 단순화된 아이템 데이터 (핵심 정보만)
      const baseItem = {
        customerId,
        serviceType: itemResult.serviceType,
        itemId: itemResult.itemId,
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
        inspectionTime: now,
        lastInspectionId: inspectionId  // 마지막 검사 ID 참조용
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
          totalResources: results.findings.length,
          issuesFound: results.findings.length,
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
          totalResources: itemData.totalResources,
          issuesFound: itemData.findings.length,
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

    // 각 finding을 적절한 항목으로 분류
    findings.forEach(finding => {
      const itemId = this.determineItemId(finding);

      if (!itemResults[itemId]) {
        itemResults[itemId] = {
          // 카테고리는 프론트엔드에서 itemId 기반으로 결정
          totalResources: 0,
          findings: []
        };
      }

      itemResults[itemId].findings.push(finding);
      itemResults[itemId].totalResources++;

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








}

module.exports = new InspectionItemService();