/**
 * Bucket CORS Checker
 * S3 버킷 CORS 설정을 검사하는 모듈
 */

const InspectionFinding = require('../../../../models/InspectionFinding');

class BucketCorsChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷 CORS 검사 실행
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      // 버킷이 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    for (const bucket of buckets) {
      try {
        this.checkBucketCorsComprehensive(bucket);
      } catch (error) {
        this.inspector.recordError(error, {
          operation: 'runAllChecks',
          bucketName: bucket.Name
        });
      }
    }
  }

  /**
   * 버킷별 통합 CORS 검사
   */
  checkBucketCorsComprehensive(bucket) {
    const cors = bucket.Cors;
    
    if (!cors || !cors.CORSRules || cors.CORSRules.length === 0) {
      // CORS가 설정되지 않은 경우 Finding을 생성하지 않음 (PASS - 보안상 안전)
    } else {
      // CORS 규칙 분석
      const hasWildcardOrigin = cors.CORSRules.some(rule => 
        rule.AllowedOrigins && rule.AllowedOrigins.includes('*')
      );
      
      if (hasWildcardOrigin) {
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: 'S3 버킷 CORS 설정 - 와일드카드 오리진 허용',
          recommendation: '보안을 위해 특정 도메인만 허용하도록 CORS 설정을 제한하세요'
        });
        this.inspector.addFinding(finding);
      } else {
        // CORS가 적절히 제한된 경우 Finding을 생성하지 않음 (PASS)
      }
    }
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(s3Client, buckets) {
    const results = { findings: [] };
    await this.runAllChecks(buckets);
    
    this.inspector.findings.forEach(finding => {
      results.findings.push({
        id: finding.resourceId,
        title: finding.issue,
        description: finding.issue,
        severity: finding.riskLevel.toLowerCase(),
        resource: finding.resourceId,
        recommendation: finding.recommendation
      });
    });

    return results;
  }

  /**
   * 권장사항 생성
   */
  getRecommendations(findings) {
    const recommendations = [];
    const corsFindings = findings.filter(f => 
      f.issue && f.issue.includes('CORS')
    );

    if (corsFindings.length > 0) {
      const wildcardFindings = corsFindings.filter(f => 
        f.issue.includes('와일드카드')
      );
      if (wildcardFindings.length > 0) {
        recommendations.push('CORS 설정에서 와일드카드 오리진을 제거하고 특정 도메인만 허용하세요.');
      }
    }

    return recommendations;
  }
}

module.exports = BucketCorsChecker;