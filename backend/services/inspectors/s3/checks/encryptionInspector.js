const BaseInspector = require('../../baseInspector');
const { S3Client, GetBucketEncryptionCommand } = require('@aws-sdk/client-s3');
const S3DataCollector = require('../collectors/s3DataCollector');

class EncryptionInspector extends BaseInspector {
  constructor() {
    super('S3');
    
    // 암호화 기준 정의 (성능 최적화)
    this.encryptionCriteria = {
      supportedAlgorithms: ['AES256', 'aws:kms'],
      recommendedAlgorithm: 'aws:kms'
    };
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
      const region = inspectionConfig.region || awsCredentials.region || 'us-east-1';
      this.region = region;
      this.awsCredentials = awsCredentials;
      
      // S3는 글로벌 서비스이므로 us-east-1로 초기 클라이언트 생성
      this.s3Client = new S3Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });

      this.dataCollector = new S3DataCollector(this.s3Client, this);
      this.logger.info(`S3 encryption inspection started for region: ${region}`);

      const buckets = await this.dataCollector.getBuckets();
      
      if (!Array.isArray(buckets)) {
        this.addFinding('buckets', 'S3Bucket', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      await this.checkEncryption(buckets);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async checkEncryption(buckets) {
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
      
      await this.checkBucketEncryption(bucket);
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

  async checkBucketEncryption(bucket) {
    const bucketName = bucket.Name;
    
    try {
      // 버킷의 실제 리전 확인
      const bucketRegion = await this.dataCollector.getBucketLocation(bucketName);
      
      // 버킷 리전에 맞는 클라이언트 생성
      const bucketClient = new S3Client({
        region: bucketRegion,
        credentials: {
          accessKeyId: this.awsCredentials.accessKeyId,
          secretAccessKey: this.awsCredentials.secretAccessKey,
          sessionToken: this.awsCredentials.sessionToken
        }
      });
      
      const encryptionConfig = await this.getBucketEncryption(bucketClient, bucketName);
      
      if (!encryptionConfig) {
        this.addFinding(
          bucketName,
          'S3Bucket',
          `기본 암호화 설정이 구성되지 않음 (리전: ${bucketRegion})`,
          'S3 버킷에 기본 암호화를 설정하여 데이터 보호 강화'
        );
        return;
      }
      
      await this.validateEncryptionConfiguration(bucketName, bucketRegion, encryptionConfig);
      
    } catch (error) {
      this.recordError(error, { context: `버킷 ${bucketName} 암호화 검사` });
    }
  }

  async getBucketEncryption(s3Client, bucketName) {
    return await this.retryableApiCall(async () => {
      try {
        const command = new GetBucketEncryptionCommand({ Bucket: bucketName });
        const response = await s3Client.send(command);
        return response.ServerSideEncryptionConfiguration;
      } catch (error) {
        if (error.name === 'ServerSideEncryptionConfigurationNotFoundError') {
          return null;
        }
        throw error;
      }
    }, 'GetBucketEncryption');
  }

  async validateEncryptionConfiguration(bucketName, bucketRegion, encryptionConfig) {
    const rules = encryptionConfig.Rules || [];
    
    if (rules.length === 0) {
      this.addFinding(
        bucketName,
        'S3Bucket',
        `암호화 규칙이 정의되지 않음 (리전: ${bucketRegion})`,
        '기본 암호화 규칙을 추가하여 데이터 보호 강화'
      );
      return;
    }
    
    const issues = [];
    
    for (const rule of rules) {
      const sse = rule.ApplyServerSideEncryptionByDefault;
      
      if (!sse) {
        issues.push('기본 암호화 설정 누락');
        continue;
      }
      
      const algorithm = sse.SSEAlgorithm;
      
      if (!this.encryptionCriteria.supportedAlgorithms.includes(algorithm)) {
        issues.push(`지원되지 않는 암호화 알고리즘: ${algorithm}`);
      } else if (algorithm === 'AES256') {
        // AES256은 작동하지만 KMS가 더 권장됨
        issues.push('KMS 암호화 권장 (현재: AES256)');
      }
      
      // KMS 키 검증 (KMS 사용 시)
      if (algorithm === 'aws:kms' && !sse.KMSMasterKeyID) {
        issues.push('KMS 키 ID 미지정 (기본 키 사용 중)');
      }
    }
    
    if (issues.length > 0) {
      this.addFinding(
        bucketName,
        'S3Bucket',
        `암호화 설정 개선 필요 (리전: ${bucketRegion}): ${issues.join(', ')}`,
        'KMS 암호화 설정 및 고객 관리형 키 사용 권장'
      );
    }
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'AccessDenied':
        this.addFinding('system', 'Permission', 'S3 암호화 설정 조회 권한 부족', 'IAM 정책에 s3:GetEncryptionConfiguration 권한 추가');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'AWS S3 암호화 API 호출' });
    }
  }
}

module.exports = EncryptionInspector;