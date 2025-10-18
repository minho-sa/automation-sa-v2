const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class StoppedInstanceInspector extends BaseInspector {
  constructor() {
    super('EC2');
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
      this.ec2Client = new EC2Client({
        region: awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });

      this.dataCollector = new EC2DataCollector(this.ec2Client, this);

      const instances = await this.dataCollector.getEC2Instances();
      
      if (!Array.isArray(instances)) {
        this.addFinding('instances', 'EC2Instance', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      await this.checkStoppedInstances(instances);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'stopped-instances',
      findings: this.findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkStoppedInstances(instances) {
    let hasFormatError = false;
    const formatErrors = new Set();
    
    for (const instance of instances) {
      this.incrementResourceCount();
      
      const validation = this.validateInstanceFormat(instance);
      if (!validation.valid) {
        if (!hasFormatError) {
          formatErrors.add(validation.error);
          hasFormatError = true;
        }
        continue;
      }
      
      await this.checkInstanceState(instance);
    }
    
    if (hasFormatError) {
      this.addFinding('format-error', 'System', 
        `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
        '데이터 구조 확인');
    }
  }

  validateInstanceFormat(instance) {
    if (!instance || typeof instance !== 'object') {
      return { valid: false, error: '인스턴스가 객체가 아님' };
    }
    
    if (!instance.InstanceId) {
      return { valid: false, error: 'InstanceId 누락' };
    }
    
    if (!instance.State || !instance.State.Name) {
      return { valid: false, error: 'State 정보 누락' };
    }
    
    return { valid: true };
  }

  async checkInstanceState(instance) {
    const instanceId = instance.InstanceId;
    const state = instance.State.Name;
    
    if (state === 'stopped') {
      const instanceName = this.getInstanceName(instance);
      const instanceType = instance.InstanceType || 'Unknown';
      
      this.addFinding(
        instanceId,
        'EC2Instance',
        `중지된 인스턴스 발견: ${instanceName} (${instanceType})`,
        '장기간 사용하지 않는 경우 인스턴스 종료를 고려하여 EBS 볼륨 비용 절약'
      );
    }
  }

  getInstanceName(instance) {
    if (!instance.Tags) return instance.InstanceId;
    
    const nameTag = instance.Tags.find(tag => tag.Key === 'Name');
    return nameTag ? nameTag.Value : instance.InstanceId;
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'UnauthorizedOperation':
        this.addFinding('system', 'Permission', 'AWS 권한 부족', 'IAM 정책 확인');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'AWS API 호출' });
    }
  }
}

module.exports = StoppedInstanceInspector;