/**
 * Inspection Finding Model (단순화됨)
 * 검사 결과 세부 항목 모델 - 핵심 정보만 포함
 */

class InspectionFinding {
  constructor({
    resourceId,
    resourceType,
    riskLevel,
    issue,
    recommendation
  }) {
    this.resourceId = resourceId;
    this.resourceType = resourceType;
    this.riskLevel = riskLevel;
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
      riskLevel: this.riskLevel,
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

    if (!this.riskLevel) {
      errors.push('riskLevel is required');
    }

    if (!this.issue) {
      errors.push('issue is required');
    }

    if (!this.recommendation) {
      errors.push('recommendation is required');
    }

    const validRiskLevels = ['PASS', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (!validRiskLevels.includes(this.riskLevel)) {
      errors.push(`riskLevel must be one of: ${validRiskLevels.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Finding 요약 통계 생성
   * @param {Array<InspectionFinding>} findings - Finding 배열
   * @returns {Object} 요약 통계
   */
  static generateSummary(findings) {
    const summary = {
      totalFindings: findings.length,
      passedChecks: 0,
      criticalIssues: 0,
      highRiskIssues: 0,
      mediumRiskIssues: 0,
      lowRiskIssues: 0
    };

    findings.forEach(finding => {
      switch (finding.riskLevel) {
        case 'PASS':
          summary.passedChecks++;
          break;
        case 'CRITICAL':
          summary.criticalIssues++;
          break;
        case 'HIGH':
          summary.highRiskIssues++;
          break;
        case 'MEDIUM':
          summary.mediumRiskIssues++;
          break;
        case 'LOW':
          summary.lowRiskIssues++;
          break;
      }
    });

    return summary;
  }
}

module.exports = InspectionFinding;