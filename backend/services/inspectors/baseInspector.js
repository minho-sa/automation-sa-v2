/**
 * Base Inspector Class
 * 모든 AWS 서비스 검사 모듈의 기본 클래스
 * Requirements: 4.1, 4.3, 4.4
 */

const InspectionFinding = require('../../models/InspectionFinding');

class BaseInspector {
  constructor(serviceType) {
    this.serviceType = serviceType;
    this.findings = [];
    this.startTime = null;
    this.resourcesScanned = 0;
    this.region = 'us-east-1'; // 기본 리전
    this.logger = this.createLogger();
  }



  async executeInspection(awsCredentials, inspectionConfig = {}) {
    this.startTime = Date.now();
    this.findings = [];
    this.resourcesScanned = 0;
    this.region = inspectionConfig.region || awsCredentials.region || 'us-east-1';

    try {
      await this.preInspectionValidation(awsCredentials, inspectionConfig);
      
      if (inspectionConfig.targetItem || inspectionConfig.targetItemId) {
        await this.performItemInspection(awsCredentials, inspectionConfig);
      } else {
        await this.performInspection(awsCredentials, inspectionConfig);
      }
      
      return this.getResults();
    } catch (error) {
      this.recordError(error, { phase: 'executeInspection' });
      throw error;
    }
  }





  /**
   * 사전 검증 (하위 클래스에서 오버라이드 가능)
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   */
  async preInspectionValidation(awsCredentials, inspectionConfig) {
    // 기본 구현 - 하위 클래스에서 오버라이드
  }

  /**
   * 실제 검사 수행 (하위 클래스에서 구현)
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<Object>} 검사 원시 결과
   */
  async performInspection(awsCredentials, inspectionConfig) {
    throw new Error('performInspection() method must be implemented by subclass');
  }

  /**
   * 개별 항목 검사 수행 (하위 클래스에서 구현)
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<Object>} 검사 원시 결과
   */
  async performItemInspection(awsCredentials, inspectionConfig) {
    // 기본적으로 전체 검사와 동일하게 처리
    return await this.performInspection(awsCredentials, inspectionConfig);
  }

  /**
   * inspectionService 호환용 메서드
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<Array>} 검사 항목 결과 배열
   */
  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    // executeInspection 호출하여 findings 수집
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    
    // inspectionService가 기대하는 itemResults 형식으로 변환
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || inspectionConfig.targetItemId || 'default',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned,
      region: this.region
    }];
  }



  getResults() {
    return this.findings.map(f => f.toApiResponse());
  }

  addFinding(resourceId, resourceType, issue, recommendation) {
    const finding = new InspectionFinding({
      resourceId,
      resourceType,
      issue,
      recommendation
    });
    
    const validation = finding.validate();
    if (validation.isValid) {
      this.findings.push(finding);
    }
  }

  /**
   * 안전한 데이터 수집 및 기본 검증
   * @param {Object} collector - 데이터 수집기
   * @param {*} target - 검사 대상
   * @returns {Promise<Object>} 검증 결과
   */
  async collectAndValidate(collector, target) {
    try {
      // 1. 리소스 존재 여부 확인
      const exists = await collector.resourceExists?.(target) ?? true;
      if (!exists) {
        return { status: 'SKIP', reason: 'RESOURCE_NOT_FOUND' };
      }

      // 2. 데이터 수집
      const data = await collector.collect(target);
      if (!data) {
        return { status: 'SKIP', reason: 'DATA_COLLECTION_FAILED' };
      }

      return { status: 'SUCCESS', data };
    } catch (error) {
      return { status: 'ERROR', reason: 'COLLECTION_ERROR', error };
    }
  }

  /**
   * 검증 결과가 리소스 부재인지 확인
   * @param {Object} validation - validateResourceData 결과
   * @returns {boolean}
   */
  isResourceNotFound(validation) {
    return validation.status === 'SKIP' && validation.reason === 'RESOURCE_NOT_FOUND';
  }

  /**
   * 검증 결과가 데이터 수집 실패인지 확인
   * @param {Object} validation - validateResourceData 결과
   * @returns {boolean}
   */
  isDataCollectionFailed(validation) {
    return validation.status === 'SKIP' && validation.reason === 'DATA_COLLECTION_FAILED';
  }

  /**
   * 수집 에러인지 확인
   * @param {Object} validation - collectAndValidate 결과
   * @returns {boolean}
   */
  isCollectionError(validation) {
    return validation.status === 'ERROR' && validation.reason === 'COLLECTION_ERROR';
  }

  /**
   * 수집 실패 시 적절한 Finding 추가
   * @param {Object} validation - collectAndValidate 결과
   * @param {string} targetId - 대상 리소스 ID
   * @param {string} resourceType - 리소스 타입
   */
  handleCollectionFailure(validation, targetId, resourceType) {
    if (this.isCollectionError(validation)) {
      this.addFinding(
        targetId,
        resourceType,
        '데이터 수집 과정에서 오류 발생',
        '시스템 관리자에게 문의하세요'
      );
    }
  }

  incrementResourceCount(count = 1) {
    this.resourcesScanned += count;
  }

  /**
   * 진행률 업데이트 (하위 클래스에서 사용)
   * @param {string} message - 진행 메시지
   * @param {number} percentage - 진행률 (0-100)
   */
  updateProgress(message, percentage) {
    // 기본 구현 - 로그만 출력
    console.log(`[${this.serviceType}] ${message} (${percentage}%)`);
  }

  /**
   * 안전한 데이터 수집 (에러 처리 포함)
   * @param {Function} collectionFn - 데이터 수집 함수
   * @param {string} resourceType - 리소스 타입
   * @returns {Promise<Array>} 수집된 데이터
   */
  async safeDataCollection(collectionFn, resourceType) {
    try {
      return await collectionFn();
    } catch (error) {
      console.error(`Failed to collect ${resourceType}:`, error.message);
      return [];
    }
  }

  /**
   * 에러 기록
   * @param {Error} error - 발생한 에러
   * @param {Object} context - 에러 컨텍스트
   */
  recordError(error, context = {}) {
    console.error(`[${this.serviceType}] Error:`, {
      message: error.message,
      context,
      stack: error.stack
    });
  }

  /**
   * 알려지지 않은 검사 항목 처리
   * @param {string} itemType - 검사 항목 타입
   */
  handleUnknownInspectionItem(itemType) {
    this.addFinding(
      itemType,
      'UNKNOWN',
      `알려지지 않은 검사 항목: ${itemType}`,
      '지원되는 검사 항목을 확인하세요'
    );
  }

  /**
   * 부분 결과 반환 (실패 시 복구용)
   * @returns {Array} 현재까지 수집된 findings
   */
  getPartialResults() {
    return this.findings.length > 0 ? [{
      serviceType: this.serviceType,
      itemId: 'partial',
      findings: this.findings.map(f => f.toApiResponse()),
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned,
      region: this.region
    }] : [];
  }

  /**
   * 로거 생성
   */
  createLogger() {
    return {
      debug: (message, meta = {}) => console.log(`[DEBUG] [${this.serviceType}] ${message}`, meta),
      info: (message, meta = {}) => console.log(`[INFO] [${this.serviceType}] ${message}`, meta),
      error: (message, meta = {}) => console.error(`[ERROR] [${this.serviceType}] ${message}`, meta)
    };
  }

}

module.exports = BaseInspector;