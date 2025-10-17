/**
 * S3 Data Collector
 * S3 관련 데이터 수집을 담당하는 모듈
 */

const { 
  ListBucketsCommand, 
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetBucketPolicyCommand,
  GetPublicAccessBlockCommand,
  GetBucketAclCommand,
  GetBucketLoggingCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketCorsCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketTaggingCommand
} = require('@aws-sdk/client-s3');

class S3DataCollector {
  constructor(s3Client, inspector) {
    this.s3Client = s3Client;
    this.inspector = inspector;
  }

  /**
   * 모든 S3 관련 데이터 수집
   */
  async collectAllData() {
    const buckets = await this.getBuckets();
    
    // 각 버킷의 상세 정보 수집
    const bucketsWithDetails = await Promise.all(
      buckets.map(bucket => this.getBucketDetails(bucket))
    );

    return {
      buckets: bucketsWithDetails
    };
  }

  /**
   * S3 버킷 목록 조회
   */
  async getBuckets() {
    try {
      const command = new ListBucketsCommand({});
      const response = await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        'ListBuckets'
      );

      const buckets = response.Buckets || [];

      // 각 버킷의 리전 정보 수집
      const bucketsWithRegion = await Promise.all(
        buckets.map(async (bucket) => {
          try {
            const locationResponse = await this.inspector.retryableApiCall(
              () => this.s3Client.send(new GetBucketLocationCommand({ Bucket: bucket.Name })),
              `GetBucketLocation-${bucket.Name}`
            );
            const region = locationResponse.LocationConstraint || 'us-east-1';
            
            return {
              ...bucket,
              Region: region,
              CreationDate: bucket.CreationDate ? bucket.CreationDate.toISOString() : null
            };
          } catch (error) {
            this.inspector.logger.warn(`버킷 ${bucket.Name}의 리전 정보를 가져올 수 없습니다:`, error.message);
            return {
              ...bucket,
              Region: 'unknown',
              CreationDate: bucket.CreationDate ? bucket.CreationDate.toISOString() : null
            };
          }
        })
      );

      return bucketsWithRegion;
    } catch (error) {
      this.inspector.recordError(error, { operation: 'getBuckets' });
      return [];
    }
  }

  /**
   * 특정 버킷의 상세 정보 수집
   */
  async getBucketDetails(bucket) {
    const details = { ...bucket };

    try {
      // 병렬로 여러 설정 정보 수집
      const [
        encryption,
        versioning,
        policy,
        publicAccessBlock,
        acl,
        logging,
        lifecycle,
        cors,
        notification,
        tagging
      ] = await Promise.allSettled([
        this.getBucketEncryption(bucket.Name),
        this.getBucketVersioning(bucket.Name),
        this.getBucketPolicy(bucket.Name),
        this.getPublicAccessBlock(bucket.Name),
        this.getBucketAcl(bucket.Name),
        this.getBucketLogging(bucket.Name),
        this.getBucketLifecycle(bucket.Name),
        this.getBucketCors(bucket.Name),
        this.getBucketNotification(bucket.Name),
        this.getBucketTagging(bucket.Name)
      ]);

      // 결과 할당 (실패한 경우 null)
      details.Encryption = encryption.status === 'fulfilled' ? encryption.value : null;
      details.Versioning = versioning.status === 'fulfilled' ? versioning.value : null;
      details.Policy = policy.status === 'fulfilled' ? policy.value : null;
      details.PublicAccessBlock = publicAccessBlock.status === 'fulfilled' ? publicAccessBlock.value : null;
      details.Acl = acl.status === 'fulfilled' ? acl.value : null;
      details.Logging = logging.status === 'fulfilled' ? logging.value : null;
      details.Lifecycle = lifecycle.status === 'fulfilled' ? lifecycle.value : null;
      details.Cors = cors.status === 'fulfilled' ? cors.value : null;
      details.Notification = notification.status === 'fulfilled' ? notification.value : null;
      details.Tagging = tagging.status === 'fulfilled' ? tagging.value : null;

    } catch (error) {
      this.inspector.recordError(error, { 
        operation: 'getBucketDetails',
        bucketName: bucket.Name 
      });
    }

    return details;
  }

  /**
   * 버킷 암호화 설정 조회
   */
  async getBucketEncryption(bucketName) {
    try {
      const command = new GetBucketEncryptionCommand({ Bucket: bucketName });
      const response = await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketEncryption-${bucketName}`
      );
      return response.ServerSideEncryptionConfiguration;
    } catch (error) {
      if (error.name === 'ServerSideEncryptionConfigurationNotFoundError') {
        return null; // 암호화 설정 없음
      }
      throw error;
    }
  }

  /**
   * 버킷 버전 관리 설정 조회
   */
  async getBucketVersioning(bucketName) {
    try {
      const command = new GetBucketVersioningCommand({ Bucket: bucketName });
      return await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketVersioning-${bucketName}`
      );
    } catch (error) {
      return null;
    }
  }

  /**
   * 버킷 정책 조회
   */
  async getBucketPolicy(bucketName) {
    try {
      const command = new GetBucketPolicyCommand({ Bucket: bucketName });
      const response = await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketPolicy-${bucketName}`
      );
      return response.Policy ? JSON.parse(response.Policy) : null;
    } catch (error) {
      if (error.name === 'NoSuchBucketPolicy') {
        return null; // 정책 없음
      }
      throw error;
    }
  }

  /**
   * 퍼블릭 액세스 차단 설정 조회
   */
  async getPublicAccessBlock(bucketName) {
    try {
      const command = new GetPublicAccessBlockCommand({ Bucket: bucketName });
      const response = await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetPublicAccessBlock-${bucketName}`
      );
      return response.PublicAccessBlockConfiguration;
    } catch (error) {
      if (error.name === 'NoSuchPublicAccessBlockConfiguration') {
        return null; // 설정 없음
      }
      throw error;
    }
  }

  /**
   * 버킷 ACL 조회
   */
  async getBucketAcl(bucketName) {
    try {
      const command = new GetBucketAclCommand({ Bucket: bucketName });
      return await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketAcl-${bucketName}`
      );
    } catch (error) {
      return null;
    }
  }

  /**
   * 버킷 로깅 설정 조회
   */
  async getBucketLogging(bucketName) {
    try {
      const command = new GetBucketLoggingCommand({ Bucket: bucketName });
      return await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketLogging-${bucketName}`
      );
    } catch (error) {
      return null;
    }
  }

  /**
   * 버킷 라이프사이클 설정 조회
   */
  async getBucketLifecycle(bucketName) {
    try {
      const command = new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName });
      return await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketLifecycle-${bucketName}`
      );
    } catch (error) {
      if (error.name === 'NoSuchLifecycleConfiguration') {
        return null; // 라이프사이클 설정 없음
      }
      throw error;
    }
  }

  /**
   * 버킷 CORS 설정 조회
   */
  async getBucketCors(bucketName) {
    try {
      const command = new GetBucketCorsCommand({ Bucket: bucketName });
      return await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketCors-${bucketName}`
      );
    } catch (error) {
      if (error.name === 'NoSuchCORSConfiguration') {
        return null; // CORS 설정 없음
      }
      throw error;
    }
  }

  /**
   * 버킷 알림 설정 조회
   */
  async getBucketNotification(bucketName) {
    try {
      const command = new GetBucketNotificationConfigurationCommand({ Bucket: bucketName });
      return await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketNotification-${bucketName}`
      );
    } catch (error) {
      return null;
    }
  }

  /**
   * 버킷 태깅 조회
   */
  async getBucketTagging(bucketName) {
    try {
      const command = new GetBucketTaggingCommand({ Bucket: bucketName });
      const response = await this.inspector.retryableApiCall(
        () => this.s3Client.send(command),
        `GetBucketTagging-${bucketName}`
      );
      return response.TagSet;
    } catch (error) {
      if (error.name === 'NoSuchTagSet') {
        return null; // 태그 없음
      }
      throw error;
    }
  }


}

module.exports = S3DataCollector;