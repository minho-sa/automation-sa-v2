/**
 * S3 Bucket Lifecycle Checker
 * S3 버킷의 라이프사이클 정책 설정을 검사합니다.
 * Requirements: 2.3 - S3 버킷 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { GetBucketLifecycleConfigurationCommand } = require('@aws-sdk/client-s3');

class BucketLifecycleChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷의 라이프사이클 정책 검사
   * @param {Array} buckets - S3 버킷 목록
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      const finding = new InspectionFinding({
        resourceId: 'no-s3-buckets',
        resourceType: 'S3Bucket',
        riskLevel: 'PASS',
        issue: 'S3 버킷이 없어 라이프사이클 검사를 수행할 수 없습니다',
        recommendation: 'S3 버킷 생성 시 라이프사이클 정책을 설정하여 비용을 최적화하세요'
      });
      
      this.inspector.addFinding(finding);
      return;
    }

    for (const bucket of buckets) {
      await this.checkBucketLifecycle(bucket);
    }
  }

  /**
   * 개별 버킷의 라이프사이클 정책 검사
   * @param {Object} bucket - S3 버킷 정보
   */
  async checkBucketLifecycle(bucket) {
    try {
      // 버킷의 리전에 맞는 S3 클라이언트 생성
      const s3Client = this.inspector.createRegionalS3Client(bucket.Region || 'us-east-1');
      
      // 라이프사이클 설정 조회
      const command = new GetBucketLifecycleConfigurationCommand({
        Bucket: bucket.Name
      });
      const lifecycleResponse = await this.inspector.retryableApiCall(
        () => s3Client.send(command),
        'GetBucketLifecycleConfiguration'
      );

      if (!lifecycleResponse.Rules || lifecycleResponse.Rules.length === 0) {
        // 라이프사이클 정책이 없는 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'LOW',
          issue: `버킷 '${bucket.Name}'에 라이프사이클 정책이 설정되어 있지 않습니다`,
          recommendation: '스토리지 비용 최적화를 위해 라이프사이클 정책을 설정하세요'
        });
        this.inspector.addFinding(finding);
      } else {
        // 라이프사이클 정책이 설정된 경우
        // 라이프사이클 정책이 설정된 경우 Finding을 생성하지 않음 (PASS)
      }

    } catch (error) {
      if (error.name === 'NoSuchLifecycleConfiguration') {
        // 라이프사이클 설정이 없는 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'LOW',
          issue: `버킷 '${bucket.Name}'에 라이프사이클 정책이 설정되어 있지 않습니다`,
          recommendation: '스토리지 비용 최적화를 위해 라이프사이클 정책을 설정하세요'
        });
        this.inspector.addFinding(finding);
      } else {
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: `버킷 '${bucket.Name}'의 라이프사이클 설정을 확인할 수 없습니다: ${error.message}`,
          recommendation: '버킷 권한을 확인하고 라이프사이클 설정을 검토하세요.'
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

module.exports = BucketLifecycleChecker;