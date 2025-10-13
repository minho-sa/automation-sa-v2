/**
 * S3 Bucket Encryption Checker
 * S3 버킷의 서버 측 암호화 설정을 검사합니다.
 * Requirements: 2.3 - S3 버킷 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { GetBucketEncryptionCommand } = require('@aws-sdk/client-s3');

class BucketEncryptionChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 버킷의 암호화 설정 검사
   * @param {Array} buckets - S3 버킷 목록
   */
  async runAllChecks(buckets) {
    if (!buckets || buckets.length === 0) {
      // 버킷이 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    for (const bucket of buckets) {
      await this.checkBucketEncryption(bucket);
    }
  }

  /**
   * 개별 버킷의 암호화 설정 검사
   * @param {Object} bucket - S3 버킷 정보
   */
  async checkBucketEncryption(bucket) {
    try {
      // 버킷의 리전에 맞는 S3 클라이언트 생성
      const s3Client = this.inspector.createRegionalS3Client(bucket.Region || 'us-east-1');

      // 암호화 설정 조회
      const command = new GetBucketEncryptionCommand({
        Bucket: bucket.Name
      });
      const encryptionResponse = await this.inspector.retryableApiCall(
        () => s3Client.send(command),
        'GetBucketEncryption'
      );

      const rules = encryptionResponse.ServerSideEncryptionConfiguration?.Rules || [];

      if (rules.length === 0) {
        // 암호화 규칙이 없는 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'HIGH',
          issue: `버킷 '${bucket.Name}'에 서버 측 암호화가 설정되어 있지 않습니다`,
          recommendation: 'S3 버킷에 서버 측 암호화를 즉시 활성화하세요. 민감한 데이터의 경우 AWS KMS 키 사용을 권장합니다.'
        });
        this.inspector.addFinding(finding);
      } else {
        // 암호화가 설정된 경우
        const rule = rules[0];
        const algorithm = rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
        const kmsMasterKeyID = rule.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID;

        // 암호화가 활성화된 경우 Finding을 생성하지 않음 (PASS)
        // 모든 암호화 설정(AES256, KMS)은 적절한 보안 수준으로 간주
      }

    } catch (error) {
      if (error.name === 'ServerSideEncryptionConfigurationNotFoundError') {
        // 암호화 설정이 없는 경우
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'HIGH',
          issue: `버킷 '${bucket.Name}'에 서버 측 암호화가 설정되어 있지 않습니다`,
          recommendation: 'S3 버킷에 서버 측 암호화를 즉시 활성화하세요.'
        });
        this.inspector.addFinding(finding);
      } else {
        const finding = new InspectionFinding({
          resourceId: bucket.Name,
          resourceType: 'S3Bucket',
          riskLevel: 'MEDIUM',
          issue: `버킷 '${bucket.Name}'의 암호화 설정을 확인할 수 없습니다: ${error.message}`,
          recommendation: '버킷 권한을 확인하고 암호화 설정을 검토하세요.'
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

module.exports = BucketEncryptionChecker;