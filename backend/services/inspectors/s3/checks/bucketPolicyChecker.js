/**
 * S3 Bucket Policy Checker
 * S3 버킷 정책의 보안 위험을 검사합니다.
 * Requirements: 2.3 - S3 버킷 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { GetBucketPolicyCommand } = require('@aws-sdk/client-s3');

class BucketPolicyChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷의 정책 검사
   * @param {Array} buckets - S3 버킷 목록
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      const finding = new InspectionFinding({
        resourceId: 'no-s3-buckets',
        resourceType: 'S3Bucket',
        riskLevel: 'PASS',
        issue: 'S3 버킷이 없어 버킷 정책 검사를 수행할 수 없습니다',
        recommendation: 'S3 버킷 생성 시 적절한 버킷 정책을 설정하여 액세스를 제어하세요'
      });
      
      this.inspector.addFinding(finding);
      return;
    }

    for (const bucket of buckets) {
      await this.checkBucketPolicy(bucket);
    }
  }

  /**
   * 개별 버킷의 정책 검사
   * @param {Object} bucket - S3 버킷 정보
   */
  async checkBucketPolicy(bucket) {
    try {
      // 버킷의 리전에 맞는 S3 클라이언트 생성
      const s3Client = this.inspector.createRegionalS3Client(bucket.Region || 'us-east-1');
      
      // 버킷 정책 조회
      const command = new GetBucketPolicyCommand({
        Bucket: bucket.Name
      });
      const policyResponse = await this.inspector.retryableApiCall(
        () => s3Client.send(command),
        'GetBucketPolicy'
      );

      const policy = JSON.parse(policyResponse.Policy);
      const dangerousPatterns = this.analyzePolicyForDangerousPatterns(policy);

      if (dangerousPatterns.length > 0) {
        // 위험한 패턴이 발견된 경우
        const riskLevel = this.getHighestRiskLevel(dangerousPatterns);
        const issues = dangerousPatterns.map(p => p.type).join(', ');
        
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: riskLevel,
          issue: `버킷 '${bucket.Name}'의 정책에서 보안 위험이 발견되었습니다: ${issues}`,
          recommendation: '버킷 정책에서 위험한 패턴을 제거하고 최소 권한 원칙을 적용하세요'
        });
        this.inspector.addFinding(finding);
      } else {
        // 안전한 정책인 경우 Finding을 생성하지 않음 (PASS)
      }

    } catch (error) {
      if (error.name === 'NoSuchBucketPolicy') {
        // 버킷 정책이 없는 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'LOW',
          issue: `버킷 '${bucket.Name}'에 정책이 설정되어 있지 않습니다`,
          recommendation: '필요에 따라 적절한 버킷 정책을 설정하여 액세스를 제어하세요'
        });
        this.inspector.addFinding(finding);
      } else {
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: `버킷 '${bucket.Name}'의 정책을 확인할 수 없습니다: ${error.message}`,
          recommendation: '버킷 권한을 확인하고 정책 설정을 검토하세요.'
        });
        this.inspector.addFinding(finding);
      }
    }
  }

  /**
   * 정책에서 위험한 패턴 분석
   * @param {Object} policy - 버킷 정책
   * @returns {Array} 위험한 패턴 목록
   */
  analyzePolicyForDangerousPatterns(policy) {
    const dangerousPatterns = [];

    if (!policy.Statement || !Array.isArray(policy.Statement)) {
      return dangerousPatterns;
    }

    policy.Statement.forEach(statement => {
      // 퍼블릭 읽기 액세스 확인
      if (this.hasPublicReadAccess(statement)) {
        dangerousPatterns.push({
          type: '퍼블릭 읽기 액세스',
          riskLevel: 'HIGH',
          recommendation: '퍼블릭 읽기 액세스를 제한하세요'
        });
      }

      // 퍼블릭 쓰기 액세스 확인
      if (this.hasPublicWriteAccess(statement)) {
        dangerousPatterns.push({
          type: '퍼블릭 쓰기 액세스',
          riskLevel: 'CRITICAL',
          recommendation: '퍼블릭 쓰기 액세스를 즉시 제거하세요'
        });
      }

      // 와일드카드 Principal 확인
      if (this.hasWildcardPrincipal(statement)) {
        dangerousPatterns.push({
          type: '와일드카드 Principal',
          riskLevel: 'HIGH',
          recommendation: '특정 Principal로 제한하세요'
        });
      }
    });

    return dangerousPatterns;
  }

  /**
   * 퍼블릭 읽기 액세스 확인
   */
  hasPublicReadAccess(statement) {
    const readActions = ['s3:GetObject', 's3:GetObjectVersion', 's3:ListBucket'];
    return statement.Effect === 'Allow' &&
           this.hasPublicPrincipal(statement) &&
           this.hasAnyAction(statement, readActions);
  }

  /**
   * 퍼블릭 쓰기 액세스 확인
   */
  hasPublicWriteAccess(statement) {
    const writeActions = ['s3:PutObject', 's3:DeleteObject', 's3:PutObjectAcl'];
    return statement.Effect === 'Allow' &&
           this.hasPublicPrincipal(statement) &&
           this.hasAnyAction(statement, writeActions);
  }

  /**
   * 퍼블릭 Principal 확인
   */
  hasPublicPrincipal(statement) {
    if (!statement.Principal) return false;
    
    if (statement.Principal === '*') return true;
    if (statement.Principal.AWS === '*') return true;
    
    return false;
  }

  /**
   * 와일드카드 Principal 확인
   */
  hasWildcardPrincipal(statement) {
    return this.hasPublicPrincipal(statement);
  }

  /**
   * 특정 액션들 중 하나라도 포함하는지 확인
   */
  hasAnyAction(statement, targetActions) {
    if (!statement.Action) return false;
    
    const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
    return actions.some(action => 
      targetActions.includes(action) || action === 's3:*' || action === '*'
    );
  }

  /**
   * 가장 높은 위험도 반환
   */
  getHighestRiskLevel(patterns) {
    const riskLevels = patterns.map(p => p.riskLevel);
    
    if (riskLevels.includes('CRITICAL')) return 'CRITICAL';
    if (riskLevels.includes('HIGH')) return 'HIGH';
    if (riskLevels.includes('MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(s3Client, buckets) {
    const results = { findings: [] };
    await this.runAllChecks(buckets);
    return results;
  }
}

module.exports = BucketPolicyChecker;