/**
 * S3 Bucket Versioning Checker
 * S3 버킷의 버전 관리 설정을 검사합니다.
 * Requirements: 2.3 - S3 버킷 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { GetBucketVersioningCommand } = require('@aws-sdk/client-s3');

class BucketVersioningChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷의 버전 관리 설정 검사
   * @param {Array} buckets - S3 버킷 목록
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      const finding = new InspectionFinding({
        resourceId: 'no-s3-buckets',
        resourceType: 'S3Bucket',
        riskLevel: 'PASS',
        issue: 'S3 버킷이 없어 버전 관리 검사를 수행할 수 없습니다',
        recommendation: 'S3 버킷 생성 시 버전 관리를 활성화하여 데이터 보호를 강화하세요'
      });
      
      this.inspector.addFinding(finding);
      return;
    }

    for (const bucket of buckets) {
      await this.checkBucketVersioning(bucket);
    }
  }

  /**
   * 개별 버킷의 버전 관리 설정 검사
   * @param {Object} bucket - S3 버킷 정보
   */
  async checkBucketVersioning(bucket) {
    try {
      // 버킷의 리전에 맞는 S3 클라이언트 생성
      const s3Client = this.inspector.createRegionalS3Client(bucket.Region || 'us-east-1');
      
      // 버전 관리 설정 조회
      const command = new GetBucketVersioningCommand({
        Bucket: bucket.Name
      });
      const versioningResponse = await this.inspector.retryableApiCall(
        () => s3Client.send(command),
        'GetBucketVersioning'
      );

      const status = versioningResponse.Status;
      const mfaDelete = versioningResponse.MfaDelete;

      if (status !== 'Enabled') {
        // 버전 관리가 비활성화된 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: `버킷 '${bucket.Name}'의 버전 관리가 비활성화되어 있습니다`,
          recommendation: '데이터 보호를 위해 버전 관리를 활성화하세요. 실수로 삭제되거나 수정된 객체를 복구할 수 있습니다.'
        });
        this.inspector.addFinding(finding);
      } else {
        // 버전 관리가 활성화된 경우
        // MFA Delete가 비활성화된 경우에만 Finding 생성
        if (mfaDelete !== 'Enabled') {
          const finding = new InspectionFinding({
            resourceId: bucket.Name,
            resourceType: 'S3Bucket',
            riskLevel: 'LOW',
            issue: `버킷 '${bucket.Name}'의 버전 관리는 활성화되어 있지만 MFA Delete가 비활성화되어 있습니다`,
            recommendation: 'MFA Delete를 활성화하여 객체 삭제 시 추가 보안을 강화하세요.'
          });
          this.inspector.addFinding(finding);
        }
        // 버전 관리가 완전히 올바르게 설정된 경우 Finding을 생성하지 않음 (PASS)
      }

    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: bucket.Name,
        resourceType: 'S3Bucket',
        riskLevel: 'MEDIUM',
        issue: `버킷 '${bucket.Name}'의 버전 관리 설정을 확인할 수 없습니다: ${error.message}`,
        recommendation: '버킷 권한을 확인하고 버전 관리 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
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

module.exports = BucketVersioningChecker;