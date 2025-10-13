/**
 * S3 Bucket Logging Checker
 * S3 버킷의 액세스 로깅 설정을 검사합니다.
 * Requirements: 2.3 - S3 버킷 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { GetBucketLoggingCommand } = require('@aws-sdk/client-s3');

class BucketLoggingChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷의 로깅 설정 검사
   * @param {Array} buckets - S3 버킷 목록
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      const finding = new InspectionFinding({
        resourceId: 'no-s3-buckets',
        resourceType: 'S3Bucket',
        riskLevel: 'PASS',
        issue: 'S3 버킷이 없어 로깅 검사를 수행할 수 없습니다',
        recommendation: 'S3 버킷 생성 시 액세스 로깅을 활성화하여 보안 모니터링을 강화하세요'
      });
      
      this.inspector.addFinding(finding);
      return;
    }

    for (const bucket of buckets) {
      await this.checkBucketLogging(bucket);
    }
  }

  /**
   * 개별 버킷의 로깅 설정 검사
   * @param {Object} bucket - S3 버킷 정보
   */
  async checkBucketLogging(bucket) {
    try {
      // 버킷의 리전에 맞는 S3 클라이언트 생성
      const s3Client = this.inspector.createRegionalS3Client(bucket.Region || 'us-east-1');
      
      // 로깅 설정 조회
      const command = new GetBucketLoggingCommand({
        Bucket: bucket.Name
      });
      const loggingResponse = await this.inspector.retryableApiCall(
        () => s3Client.send(command),
        'GetBucketLogging'
      );

      if (!loggingResponse.LoggingEnabled) {
        // 로깅이 비활성화된 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: `버킷 '${bucket.Name}'의 액세스 로깅이 비활성화되어 있습니다`,
          recommendation: '보안 모니터링과 감사를 위해 액세스 로깅을 활성화하세요'
        });
        this.inspector.addFinding(finding);
      } else {
        // 로깅이 활성화된 경우
        // 액세스 로깅이 활성화된 경우 Finding을 생성하지 않음 (PASS)
      }

    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: bucket.Name,
        resourceType: 'S3Bucket',
        riskLevel: 'MEDIUM',
        issue: `버킷 '${bucket.Name}'의 로깅 설정을 확인할 수 없습니다: ${error.message}`,
        recommendation: '버킷 권한을 확인하고 로깅 설정을 검토하세요.'
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

module.exports = BucketLoggingChecker;