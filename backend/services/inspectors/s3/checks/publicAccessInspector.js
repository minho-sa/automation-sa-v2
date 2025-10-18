const BaseInspector = require('../../baseInspector');
const { S3Client } = require('@aws-sdk/client-s3');
const S3DataCollector = require('../collectors/s3DataCollector');

class PublicAccessInspector extends BaseInspector {
  constructor() {
    super('S3');
  }

  async retryableApiCall(apiCall, operationName, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async performInspection(awsCredentials, inspectionConfig) {
    try {
      this.s3Client = new S3Client({
        region: awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });

      this.dataCollector = new S3DataCollector(this.s3Client, this);

      const buckets = await this.dataCollector.getBuckets();
      
      if (!Array.isArray(buckets)) {
        this.addFinding('buckets', 'S3Bucket', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      await this.checkPublicAccess(buckets);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'public-access',
      findings: this.findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkPublicAccess(buckets) {
    let hasFormatError = false;
    const formatErrors = new Set();
    
    for (const bucket of buckets) {
      this.incrementResourceCount();
      
      const validation = this.validateBucketFormat(bucket);
      if (!validation.valid) {
        if (!hasFormatError) {
          formatErrors.add(validation.error);
          hasFormatError = true;
        }
        continue;
      }
      
      await this.checkBucketPublicAccess(bucket);
    }
    
    if (hasFormatError) {
      this.addFinding('format-error', 'System', 
        `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
        '데이터 구조 확인');
    }
  }

  validateBucketFormat(bucket) {
    if (!bucket || typeof bucket !== 'object') {
      return { valid: false, error: '버킷이 객체가 아님' };
    }
    
    if (!bucket.Name) {
      return { valid: false, error: 'Name 누락' };
    }
    
    return { valid: true };
  }

  async checkBucketPublicAccess(bucket) {
    const bucketName = bucket.Name;
    
    try {
      const publicAccessBlock = await this.dataCollector.getPublicAccessBlock(bucketName);
      
      if (!publicAccessBlock) {
        this.addFinding(
          bucketName,
          'S3Bucket',
          '퍼블릭 액세스 차단 설정이 구성되지 않음',
          '퍼블릭 액세스 차단 설정을 활성화하여 보안 강화'
        );
        return;
      }
      
      const issues = [];
      
      if (!publicAccessBlock.BlockPublicAcls) {
        issues.push('퍼블릭 ACL 허용');
      }
      
      if (!publicAccessBlock.IgnorePublicAcls) {
        issues.push('퍼블릭 ACL 무시 비활성화');
      }
      
      if (!publicAccessBlock.BlockPublicPolicy) {
        issues.push('퍼블릭 정책 허용');
      }
      
      if (!publicAccessBlock.RestrictPublicBuckets) {
        issues.push('퍼블릭 버킷 제한 비활성화');
      }
      
      if (issues.length > 0) {
        this.addFinding(
          bucketName,
          'S3Bucket',
          `퍼블릭 액세스 차단 설정 미흡: ${issues.join(', ')}`,
          '모든 퍼블릭 액세스 차단 옵션을 활성화하여 보안 강화'
        );
      }
    } catch (error) {
      // 에러는 로그만 기록하고 다음 버킷으로 진행
      this.recordError(error, { context: `버킷 ${bucketName} 퍼블릭 액세스 검사` });
    }
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'AccessDenied':
        this.addFinding('system', 'Permission', 'S3 권한 부족', 'IAM 정책에 S3 권한 추가');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'AWS S3 API 호출' });
    }
  }
}

module.exports = PublicAccessInspector;