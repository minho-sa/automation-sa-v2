/**
 * Inspection Finding Model - CRITICAL/WARN 시스템
 * 검사 결과 세부 항목 모델 - riskLevel 제거, 검사 항목 severity 상속
 */

class InspectionFinding {
  constructor({
    resourceId,
    resourceType,
    issue,
    recommendation
  }) {
    this.resourceId = resourceId;
    this.resourceType = resourceType;
    this.issue = issue;
    this.recommendation = recommendation;
  }

  /**
   * API 응답용 객체 변환
   * @returns {Object} API 응답 형식
   */
  toApiResponse() {
    return {
      resourceId: this.resourceId,
      resourceType: this.resourceType,
      issue: this.issue,
      recommendation: this.recommendation
    };
  }

  /**
   * 유효성 검증
   * @returns {Object} 유효성 검증 결과
   */
  validate() {
    const errors = [];

    if (!this.resourceId) {
      errors.push('resourceId is required');
    }

    if (!this.resourceType) {
      errors.push('resourceType is required');
    }

    if (!this.issue) {
      errors.push('issue is required');
    }

    if (!this.recommendation) {
      errors.push('recommendation is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Finding 요약 통계 생성 - 단순화
   * @param {Array<InspectionFinding>} findings - Finding 배열
   * @returns {Object} 요약 통계
   */
  static generateSummary(findings) {
    return {
      totalFindings: findings.length,
      resourcesAffected: [...new Set(findings.map(f => f.resourceId))].length,
      criticalIssues: 0,
      highRiskIssues: 0, 
      mediumRiskIssues: 0,
      lowRiskIssues: 0,
      categories: []
    };
  }
}

module.exports = InspectionFinding;