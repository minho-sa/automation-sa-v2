/**
 * Base Inspector Class
 * 모든 AWS 서비스 검사 모듈의 기본 클래스
 * Requirements: 4.1, 4.3, 4.4
 */

const InspectionResult = require('../../models/InspectionResult');
const InspectionFinding = require('../../models/InspectionFinding');
const { v4: uuidv4 } = require('uuid');

class BaseInspector {
  constructor(serviceType, options = {}) {
    this.serviceType = serviceType;
    this.options = {
      timeout: 300000, // 5분 기본 타임아웃
      maxRetries: 3,
      retryDelay: 1000,
      ...options
    };
    this.logger = this.createLogger();
    this.findings = [];
    this.errors = [];
    this.metadata = {
      inspectorVersion: this.getVersion(),
      startTime: null,
      endTime: null,
      resourcesScanned: 0
    };
  }

  /**
   * 검사 실행 메인 메서드 (추상 메서드)
   * 하위 클래스에서 반드시 구현해야 함
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<InspectionResult>} 검사 결과
   */
  async inspect(awsCredentials, inspectionConfig) {
    throw new Error('inspect() method must be implemented by subclass');
  }

  /**
   * 개별 항목 검사 실행 템플릿 메서드
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<InspectionResult>} 검사 결과
   */
  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig = {}) {
    const inspectionResult = new InspectionResult({
      customerId,
      inspectionId,
      serviceType: this.serviceType,
      status: 'IN_PROGRESS',
      assumeRoleArn: awsCredentials.roleArn,
      metadata: {
        ...this.metadata,
        inspectorVersion: this.getVersion(),
        targetItem: inspectionConfig.targetItem
      }
    });

    try {
      this.logger.info(`Starting ${this.serviceType} item inspection`, {
        customerId,
        inspectionId,
        serviceType: this.serviceType,
        targetItem: inspectionConfig.targetItem
      });

      // 개별 검사 시작 시 findings 배열 초기화
      this.findings = [];
      this.errors = [];
      this.metadata.startTime = Date.now();

      // 사전 검증
      await this.preInspectionValidation(awsCredentials, inspectionConfig);

      // 개별 항목 검사 실행
      const results = await this.performItemInspection(awsCredentials, inspectionConfig);

      // 사후 처리
      await this.postInspectionProcessing(results);

      this.metadata.endTime = Date.now();

      // 검사 결과 완료 처리
      const finalResults = this.buildFinalResults(results);
      inspectionResult.complete(finalResults);

      // itemResults 생성 (TransactionService에서 필요)
      inspectionResult.itemResults = this.buildItemResults(inspectionConfig);

      this.logger.info(`Completed ${this.serviceType} item inspection`, {
        customerId,
        inspectionId,
        targetItem: inspectionConfig.targetItem,
        duration: inspectionResult.duration,
        resourcesScanned: this.metadata.resourcesScanned,
        findingsCount: this.findings.length
      });

      return inspectionResult;

    } catch (error) {
      this.metadata.endTime = Date.now();

      this.logger.error(`Failed ${this.serviceType} item inspection`, {
        customerId,
        inspectionId,
        targetItem: inspectionConfig.targetItem,
        error: error.message,
        stack: error.stack
      });

      inspectionResult.fail(error.message);
      return inspectionResult;
    }
  }

  /**
   * 검사 실행 템플릿 메서드
   * 공통 검사 플로우를 정의하고 하위 클래스의 구체적인 검사 로직을 호출
   * @param {string} customerId - 고객 ID
   * @param {string} inspectionId - 검사 ID (이미 생성된 ID 사용)
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<InspectionResult>} 검사 결과
   */
  async executeInspection(customerId, inspectionId, awsCredentials, inspectionConfig = {}) {
    const inspectionResult = new InspectionResult({
      customerId,
      inspectionId, // 전달받은 inspectionId 사용
      serviceType: this.serviceType,
      status: 'IN_PROGRESS',
      assumeRoleArn: awsCredentials.roleArn,
      metadata: {
        ...this.metadata,
        inspectorVersion: this.getVersion()
      }
    });

    try {
      this.logger.info(`Starting ${this.serviceType} inspection`, {
        customerId,
        inspectionId,
        serviceType: this.serviceType
      });

      // 전체 검사 시작 시 findings 배열 초기화
      this.findings = [];
      this.errors = [];
      this.metadata.startTime = Date.now();

      // 사전 검증
      await this.preInspectionValidation(awsCredentials, inspectionConfig);

      // 실제 검사 실행
      const results = await this.performInspection(awsCredentials, inspectionConfig);

      // 사후 처리
      await this.postInspectionProcessing(results);

      this.metadata.endTime = Date.now();

      // 검사 결과 완료 처리
      const finalResults = this.buildFinalResults(results);
      inspectionResult.complete(finalResults);

      // itemResults 생성 (전체 검사의 경우 모든 항목을 하나로 통합)
      inspectionResult.itemResults = this.buildFullInspectionItemResults();

      this.logger.info(`Completed ${this.serviceType} inspection`, {
        customerId,
        inspectionId,
        duration: inspectionResult.duration,
        resourcesScanned: this.metadata.resourcesScanned,
        findingsCount: this.findings.length
      });

      return inspectionResult;

    } catch (error) {
      this.metadata.endTime = Date.now();

      this.logger.error(`Failed ${this.serviceType} inspection`, {
        customerId,
        inspectionId,
        error: error.message,
        stack: error.stack
      });

      // 부분 결과라도 반환하도록 처리
      const partialResults = this.buildPartialResults(error);
      inspectionResult.fail(error.message);
      inspectionResult.results = partialResults;

      return inspectionResult;
    }
  }

  /**
   * 사전 검증 (하위 클래스에서 오버라이드 가능)
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   */
  async preInspectionValidation(awsCredentials, inspectionConfig) {
    // AWS 자격 증명 검증
    if (!awsCredentials || !awsCredentials.accessKeyId || !awsCredentials.secretAccessKey) {
      throw new Error('Invalid AWS credentials provided');
    }

    // 기본 검증 로직
    this.logger.debug('Pre-inspection validation completed');
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
   * 개별 항목 검사 수행 (추상 메서드)
   * 하위 클래스에서 구현 가능 (선택사항)
   * @param {Object} awsCredentials - AWS 자격 증명
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Promise<Object>} 검사 원시 결과
   */
  async performItemInspection(awsCredentials, inspectionConfig) {
    // 기본적으로 전체 검사로 폴백
    return this.performInspection(awsCredentials, inspectionConfig);
  }

  /**
   * 사후 처리 (하위 클래스에서 오버라이드 가능)
   * @param {Object} results - 검사 원시 결과
   */
  async postInspectionProcessing(results) {
    // 기본 사후 처리 로직
    this.logger.debug('Post-inspection processing completed');
  }

  /**
   * 최종 검사 결과 구성
   * @param {Object} rawResults - 원시 검사 결과
   * @returns {Object} 표준화된 검사 결과
   */
  buildFinalResults(rawResults) {
    const summary = InspectionFinding.generateSummary(this.findings);

    return {
      summary: {
        totalResources: this.metadata.resourcesScanned,
        highRiskIssues: summary.highRiskIssues,
        mediumRiskIssues: summary.mediumRiskIssues,
        lowRiskIssues: summary.lowRiskIssues,
        criticalIssues: summary.criticalIssues,
        categories: summary.categories
      },
      findings: this.findings.map(finding => finding.toApiResponse()),
      metadata: {
        ...this.metadata,
        duration: this.metadata.endTime - this.metadata.startTime,
        errorsEncountered: this.errors.length
      }
    };
  }

  /**
   * 개별 항목 검사 결과 생성 (TransactionService용)
   * @param {Object} inspectionConfig - 검사 설정
   * @returns {Array} 항목 검사 결과 배열
   */
  buildItemResults(inspectionConfig) {
    const summary = InspectionFinding.generateSummary(this.findings);

    // 상태 결정
    let status = 'PASS';
    if (summary.criticalIssues > 0 || summary.highRiskIssues > 0) {
      status = 'FAIL';
    } else if (summary.mediumRiskIssues > 0) {
      status = 'WARNING';
    }

    // 단순화: findings 배열만 반환, severity는 프론트엔드에서 결정
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem,
      category: this.getCategoryForItem(inspectionConfig.targetItem),
      status: status,
      totalResources: this.metadata.resourcesScanned || 0,
      issuesFound: this.findings.length,
      findings: this.findings.map(finding => finding.toApiResponse()),
      inspectionTime: new Date().toISOString()
    }];
  }

  /**
   * 전체 검사 결과를 항목별로 분할 (TransactionService용)
   * @returns {Array} 항목 검사 결과 배열
   */
  buildFullInspectionItemResults() {
    const summary = InspectionFinding.generateSummary(this.findings);

    // 상태 결정
    let status = 'PASS';
    if (summary.criticalIssues > 0 || summary.highRiskIssues > 0) {
      status = 'FAIL';
    } else if (summary.mediumRiskIssues > 0) {
      status = 'WARNING';
    }

    // 위험도 결정
    let riskLevel = 'LOW';
    if (summary.criticalIssues > 0) {
      riskLevel = 'CRITICAL';
    } else if (summary.highRiskIssues > 0) {
      riskLevel = 'HIGH';
    } else if (summary.mediumRiskIssues > 0) {
      riskLevel = 'MEDIUM';
    }

    return [{
      serviceType: this.serviceType,
      itemId: 'all',
      category: 'security',
      status: status,
      riskLevel: riskLevel,
      totalResources: this.metadata.resourcesScanned || 0,
      issuesFound: this.findings.length,
      findings: this.findings.map(finding => finding.toApiResponse())
    }];
  }

  /**
   * 항목별 카테고리 결정
   * @param {string} itemId - 항목 ID
   * @returns {string} 카테고리
   */
  getCategoryForItem(itemId) {
    const categoryMap = {
      // 보안 관련
      'dangerous-ports': 'security',

      'ebs-encryption': 'security',
      'bucket-encryption': 'security',
      'bucket-public-access': 'security',
      'overprivileged-user-policies': 'security',
      'overprivileged-role-policies': 'security',

      // 비용 최적화
      'unused-security-groups': 'cost-optimization',
      'unused-elastic-ip': 'cost-optimization',
      'old-snapshots': 'cost-optimization',
      'stopped-instances': 'cost-optimization',
      'unused-policies': 'cost-optimization',

      // 운영 효율성
      'termination-protection': 'operational-excellence',
      'ebs-volume-version': 'operational-excellence',
      'bucket_versioning': 'operational_excellence',
      'bucket_lifecycle': 'operational_excellence',
      'bucket_logging': 'operational_excellence'
    };

    return categoryMap[itemId] || 'security';
  }

  /**
   * 부분 결과 구성 (오류 발생 시)
   * @param {Error} error - 발생한 오류
   * @returns {Object} 부분 검사 결과
   */
  buildPartialResults(error) {
    const summary = InspectionFinding.generateSummary(this.findings);

    return {
      summary: {
        totalResources: this.metadata.resourcesScanned,
        highRiskIssues: summary.highRiskIssues,
        mediumRiskIssues: summary.mediumRiskIssues,
        lowRiskIssues: summary.lowRiskIssues,
        criticalIssues: summary.criticalIssues,
        categories: summary.categories
      },
      findings: this.findings.map(finding => finding.toApiResponse()),
      error: {
        message: error.message,
        type: error.constructor.name,
        timestamp: Date.now()
      },
      metadata: {
        ...this.metadata,
        duration: this.metadata.endTime - this.metadata.startTime,
        errorsEncountered: this.errors.length,
        partialResults: true
      }
    };
  }

  /**
   * Finding 추가
   * @param {InspectionFinding} finding - 검사 결과 항목
   */
  addFinding(finding) {
    if (!(finding instanceof InspectionFinding)) {
      throw new Error('Finding must be an instance of InspectionFinding');
    }

    const validation = finding.validate();
    if (!validation.isValid) {
      throw new Error(`Invalid finding: ${validation.errors.join(', ')}`);
    }

    this.findings.push(finding);
    this.logger.debug('Finding added', {
      resourceId: finding.resourceId,
      riskLevel: finding.riskLevel,
      issue: finding.issue
    });
  }

  /**
   * 오류 기록
   * @param {Error} error - 오류 객체
   * @param {Object} context - 추가 컨텍스트 정보
   */
  recordError(error, context = {}) {
    const errorRecord = {
      message: error.message,
      type: error.constructor.name,
      timestamp: Date.now(),
      context
    };

    this.errors.push(errorRecord);
    this.logger.error('Error recorded during inspection', errorRecord);
  }







  /**
   * 재시도 로직이 포함된 AWS API 호출
   * @param {Function} apiCall - AWS API 호출 함수
   * @param {string} operationName - 작업 이름 (로깅용)
   * @returns {Promise<any>} API 호출 결과
   */
  async retryableApiCall(apiCall, operationName) {
    let lastError;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        this.logger.debug(`Attempting ${operationName}`, { attempt });
        const result = await apiCall();
        return result;
      } catch (error) {
        lastError = error;

        if (attempt === this.options.maxRetries) {
          this.logger.error(`Failed ${operationName} after ${attempt} attempts`, {
            error: error.message
          });
          break;
        }

        // 재시도 가능한 오류인지 확인
        if (this.isRetryableError(error)) {
          this.logger.warn(`Retrying ${operationName} after error`, {
            attempt,
            error: error.message,
            retryDelay: this.options.retryDelay
          });

          await this.sleep(this.options.retryDelay * attempt);
        } else {
          // 재시도 불가능한 오류는 즉시 throw
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * 재시도 가능한 오류인지 판단
   * @param {Error} error - 오류 객체
   * @returns {boolean} 재시도 가능 여부
   */
  isRetryableError(error) {
    const retryableErrorCodes = [
      'Throttling',
      'ThrottlingException',
      'RequestLimitExceeded',
      'ServiceUnavailable',
      'InternalServerError',
      'NetworkingError'
    ];

    return retryableErrorCodes.some(code =>
      error.code === code || (error.message && error.message.includes(code))
    );
  }

  /**
   * 지연 함수
   * @param {number} ms - 지연 시간 (밀리초)
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 로거 생성
   * @returns {Object} 로거 객체
   */
  createLogger() {
    return {
      debug: (message, meta = {}) => {
        // DEBUG 로그 완전 비활성화
      },
      info: (message, meta = {}) => {
        // INFO 로그 완전 비활성화 (에러와 경고만 유지)
      },
      warn: (message, meta = {}) => {
        console.warn(`[WARN] [${this.serviceType}Inspector] ${message}`, meta);
      },
      error: (message, meta = {}) => {
        console.error(`[ERROR] [${this.serviceType}Inspector] ${message}`, meta);
      }
    };
  }

  /**
   * Inspector 버전 반환 (하위 클래스에서 오버라이드)
   * @returns {string} 버전 정보
   */
  getVersion() {
    return 'base-inspector-v1.0';
  }

  /**
   * 지원하는 검사 유형 목록 반환 (하위 클래스에서 구현)
   * @returns {Array<string>} 검사 유형 목록
   */
  getSupportedInspectionTypes() {
    return [];
  }

  /**
   * Inspector 정보 반환
   * @returns {Object} Inspector 정보
   */
  getInspectorInfo() {
    return {
      serviceType: this.serviceType,
      version: this.getVersion(),
      supportedInspectionTypes: this.getSupportedInspectionTypes(),
      options: this.options
    };
  }

  /**
   * 리소스 카운트 증가
   * @param {number} count - 증가할 카운트 (기본값: 1)
   */
  incrementResourceCount(count = 1) {
    this.metadata.resourcesScanned += count;
  }

  /**
   * 진행 상황 업데이트 (향상된 버전)
   * @param {string} currentStep - 현재 진행 단계
   * @param {number} progress - 진행률 (0-100)
   * @param {Object} additionalData - 추가 진행률 데이터
   */
  updateProgress(currentStep, progress, additionalData = {}) {
    // 메타데이터 업데이트
    this.metadata.currentStep = currentStep;
    this.metadata.progress = progress;
    this.metadata.lastUpdated = Date.now();

    // 추가 데이터 병합
    if (additionalData.resourcesProcessed !== undefined) {
      this.metadata.resourcesProcessed = additionalData.resourcesProcessed;
    }
    if (additionalData.totalResources !== undefined) {
      this.metadata.totalResources = additionalData.totalResources;
    }
    if (additionalData.stepDetails) {
      this.metadata.stepDetails = additionalData.stepDetails;
    }

    this.logger.info('Inspection progress update', {
      currentStep,
      progress: `${progress}%`,
      resourcesScanned: this.metadata.resourcesScanned,
      resourcesProcessed: this.metadata.resourcesProcessed,
      totalResources: this.metadata.totalResources,
      stepDetails: additionalData.stepDetails
    });

    // 진행률 콜백이 설정된 경우 호출
    if (this.progressCallback) {
      this.progressCallback({
        currentStep,
        progress,
        resourcesScanned: this.metadata.resourcesScanned,
        ...additionalData
      });
    }
  }

  /**
   * 진행률 콜백 설정
   * @param {Function} callback - 진행률 업데이트 콜백 함수
   */
  setProgressCallback(callback) {
    this.progressCallback = callback;
  }
  // severity 관련 메서드 제거 - 프론트엔드에서만 처리
}

module.exports = BaseInspector;