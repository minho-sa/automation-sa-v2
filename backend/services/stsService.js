const { AssumeRoleCommand, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { stsClient } = require('../config/aws');

/**
 * STS 서비스
 * 모든 STS 관련 작업을 통합 관리
 */
class STSService {
  constructor() {
    this.client = stsClient;
    this.activeRoles = new Map(); // 활성 역할 세션 캐시
  }

  /**
   * 검사용 AssumeRole (장기 세션)
   */
  async assumeRoleForInspection(roleArn, inspectionId) {
    try {
      if (!this.isValidArnFormat(roleArn)) {
        throw new Error(`Invalid ARN format: ${roleArn}`);
      }

      const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `inspection-${inspectionId}`,
        DurationSeconds: 3600,
        ExternalId: process.env.AWS_EXTERNAL_ID
      });

      const response = await this.client.send(command);
      
      return {
        accessKeyId: response.Credentials.AccessKeyId,
        secretAccessKey: response.Credentials.SecretAccessKey,
        sessionToken: response.Credentials.SessionToken,
        expiration: response.Credentials.Expiration,
        roleArn,
        region: process.env.AWS_REGION || 'us-east-1'
      };
    } catch (error) {
      throw this.handleStsError(error, roleArn);
    }
  }

  /**
   * 검증용 AssumeRole (단기 세션)
   */
  async validateRoleArn(roleArn, sessionName = 'validation') {
    try {
      if (!this.isValidArnFormat(roleArn)) {
        return {
          success: false,
          isValid: false,
          error: 'Invalid ARN format'
        };
      }

      const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: sessionName,
        DurationSeconds: 900
      });

      const result = await this.client.send(command);
      
      return {
        success: true,
        isValid: true,
        credentials: {
          accessKeyId: result.Credentials.AccessKeyId,
          secretAccessKey: result.Credentials.SecretAccessKey,
          sessionToken: result.Credentials.SessionToken,
          expiration: result.Credentials.Expiration
        }
      };
    } catch (error) {
      return {
        success: false,
        isValid: false,
        error: error.message
      };
    }
  }

  /**
   * ARN 형식 검증
   */
  isValidArnFormat(arn) {
    if (!arn || typeof arn !== 'string') return false;
    const arnRegex = /^arn:aws:iam::\d{12}:role\/[\w+=,.@\/-]+$/;
    return arnRegex.test(arn);
  }

  /**
   * STS 에러 처리
   */
  handleStsError(error, roleArn) {
    if (error.name === 'AccessDenied') {
      return new Error(`Access denied when assuming role ${roleArn}`);
    } else if (error.name === 'InvalidParameterValue') {
      return new Error(`Invalid role ARN: ${roleArn}`);
    }
    return new Error(`Failed to assume role: ${error.message}`);
  }
}

module.exports = new STSService();