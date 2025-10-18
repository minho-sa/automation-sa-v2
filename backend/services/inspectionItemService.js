const dynamoService = require('./dynamoService');

// 환경변수 로드
require('dotenv').config();

/**
 * 검사 항목별 결과 관리 서비스
 * AWS Trusted Advisor 스타일의 항목별 상태 관리
 */
class InspectionItemService {
  constructor() {
    this.dynamoService = dynamoService;
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
        region: itemResult.region || 'us-east-1',
        findings: itemResult.findings || []
      };

      // 모델 헬퍼 함수 사용
      const { InspectionItemResult } = require('../models');

      // 1. 히스토리용 레코드 저장 (간소화된 키 구조)
      const historyKey = InspectionItemResult.helpers.createHistoryKey(
        now,
        itemResult.serviceType,
        inspectionId
      );

      const historyItem = {
        ...baseItem,
        itemKey: historyKey,
        inspectionId: inspectionId,
        inspectionTime: now
      };

      // 2. 최신 상태용 레코드 저장/업데이트 (LATEST)
      const latestKey = InspectionItemResult.helpers.createLatestKey(
        itemResult.serviceType, 
        itemResult.itemId,
        itemResult.region || 'us-east-1'
      );
      const latestItem = {
        ...baseItem,
        itemKey: latestKey,
        inspectionTime: now,
        lastInspectionId: inspectionId  // 마지막 검사 ID 참조용
      };

      // 두 레코드 모두 저장
      await Promise.all([
        this.dynamoService.saveInspectionItem(historyItem),
        this.dynamoService.saveInspectionItem(latestItem)
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
}

module.exports = new InspectionItemService();