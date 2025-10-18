const { ListBucketsCommand, GetBucketLocationCommand, GetPublicAccessBlockCommand } = require('@aws-sdk/client-s3');
const { S3Client } = require('@aws-sdk/client-s3');

class S3DataCollector {
  constructor(s3Client, inspector) {
    this.s3Client = s3Client;
    this.inspector = inspector;
  }

  async getBuckets() {
    return await this.inspector.retryableApiCall(async () => {
      const command = new ListBucketsCommand({});
      const response = await this.s3Client.send(command);
      return response.Buckets || [];
    }, 'ListBuckets');
  }

  async getBucketLocation(bucketName) {
    return await this.inspector.retryableApiCall(async () => {
      try {
        const command = new GetBucketLocationCommand({ Bucket: bucketName });
        const response = await this.s3Client.send(command);
        return response.LocationConstraint || 'us-east-1';
      } catch (error) {
        if (error.name === 'PermanentRedirect') {
          return 'us-east-1'; // 기본값 반환
        }
        throw error;
      }
    }, 'GetBucketLocation');
  }

  async getPublicAccessBlock(bucketName) {
    return await this.inspector.retryableApiCall(async () => {
      try {
        const command = new GetPublicAccessBlockCommand({ Bucket: bucketName });
        const response = await this.s3Client.send(command);
        return response.PublicAccessBlockConfiguration;
      } catch (error) {
        if (error.name === 'NoSuchPublicAccessBlockConfiguration') {
          return null;
        }
        // PermanentRedirect 에러 제거 - 이제 올바른 리전 클라이언트를 사용하므로 발생하지 않음
        throw error;
      }
    }, 'GetPublicAccessBlock');
  }
}

module.exports = S3DataCollector;