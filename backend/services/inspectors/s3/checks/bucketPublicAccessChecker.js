/**
 * S3 Bucket Public Access Checker
 * S3 버킷의 퍼블릭 액세스 차단 설정을 검사합니다.
 * Requirements: 2.3 - S3 버킷 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { GetPublicAccessBlockCommand } = require('@aws-sdk/client-s3');

class BucketPublicAccessChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷의 퍼블릭 액세스 차단 설정 검사
   * @param {Array} buckets - S3 버킷 목록
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      const finding = new InspectionFinding({
        resourceId: 'no-s3-buckets',
        resourceType: 'S3Bucket',
        riskLevel: 'PASS',
        issue: 'S3 버킷이 없어 퍼블릭 액세스 검사를 수행할 수 없습니다',
        recommendation: 'S3 버킷 생성 시 퍼블릭 액세스 차단을 기본으로 활성화하세요'
      });
      
      this.inspector.addFinding(finding);
      return;
    }

    for (const bucket of buckets) {
      await this.checkBucketPublicAccess(bucket);
    }
  }

  /**
   * 개별 버킷의 퍼블릭 액세스 차단 설정 검사
   * @param {Object} bucket - S3 버킷 정보
   */
  async checkBucketPublicAccess(bucket) {
    try {
      // 버킷의 리전에 맞는 S3 클라이언트 생성
      const s3Client = this.inspector.createRegionalS3Client(bucket.Region || 'us-east-1');
      
      // 퍼블릭 액세스 차단 설정 조회
      const command = new GetPublicAccessBlockCommand({
        Bucket: bucket.Name
      });
      const publicAccessResponse = await this.inspector.retryableApiCall(
        () => s3Client.send(command),
        'GetPublicAccessBlock'
      );

      const config = publicAccessResponse.PublicAccessBlockConfiguration;
      
      // 모든 퍼블릭 액세스 차단 설정 확인
      const allBlocked = config.BlockPublicAcls && 
                        config.IgnorePublicAcls && 
                        config.BlockPublicPolicy && 
                        config.RestrictPublicBuckets;

      if (allBlocked) {
        // 모든 퍼블릭 액세스가 차단된 경우 - 안전
        // 퍼블릭 액세스가 완전히 차단된 경우 Finding을 생성하지 않음 (PASS)
      } else {
        // 일부 퍼블릭 액세스가 허용된 경우
        const unblocked = [];
        if (!config.BlockPublicAcls) unblocked.push('퍼블릭 ACL');
        if (!config.IgnorePublicAcls) unblocked.push('퍼블릭 ACL 무시');
        if (!config.BlockPublicPolicy) unblocked.push('퍼블릭 정책');
        if (!config.RestrictPublicBuckets) unblocked.push('퍼블릭 버킷 제한');

        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'HIGH',
          issue: `버킷 '${bucket.Name}'에서 퍼블릭 액세스가 부분적으로 허용되어 있습니다: ${unblocked.join(', ')}`,
          recommendation: '보안을 위해 모든 퍼블릭 액세스 차단 설정을 활성화하세요.'
        });
        this.inspector.addFinding(finding);
      }

    } catch (error) {
      if (error.name === 'NoSuchPublicAccessBlockConfiguration') {
        // 퍼블릭 액세스 차단 설정이 없는 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'CRITICAL',
          issue: `버킷 '${bucket.Name}'에 퍼블릭 액세스 차단 설정이 없습니다`,
          recommendation: '즉시 퍼블릭 액세스 차단 설정을 활성화하여 보안을 강화하세요.'
        });
        this.inspector.addFinding(finding);
      } else {
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: `버킷 '${bucket.Name}'의 퍼블릭 액세스 설정을 확인할 수 없습니다: ${error.message}`,
          recommendation: '버킷 권한을 확인하고 퍼블릭 액세스 설정을 검토하세요.'
        });
        this.inspector.addFinding(finding);
      }
    }
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

module.exports = BucketPublicAccessChecker;