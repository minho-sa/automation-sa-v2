const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class PublicInstanceInspector extends BaseInspector {
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
      
      await this.checkPublicInstances(instances);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'default',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkPublicInstances(instances) {
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
      
      await this.checkInstancePublicAccess(instance);
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
    
    return { valid: true };
  }

  async checkInstancePublicAccess(instance) {
    const instanceId = instance.InstanceId;
    const instanceName = this.getInstanceName(instance);
    
    if (instance.State?.Name !== 'running') return;
    
    const issues = [];
    const recommendations = [];
    
    // 퍼블릭 IP 할당 상태 검사
    const hasPublicIp = instance.PublicIpAddress || instance.PublicDnsName;
    if (hasPublicIp) {
      issues.push('퍼블릭 IP 할당됨');
      recommendations.push('불필요한 퍼블릭 액세스 제거');
    }
    
    // 서브넷의 퍼블릭 IP 자동 할당 설정 검사
    if (instance.SubnetId) {
      const hasAutoAssign = await this.checkSubnetAutoAssign(instance.SubnetId);
      if (hasAutoAssign) {
        issues.push('퍼블릭 IP 자동 할당 서브넷');
        recommendations.push('서브넷 자동 할당 설정 비활성화');
      }
    }
    
    if (issues.length > 0) {
      this.addFinding(
        instanceId,
        'EC2Instance',
        `${instanceName || instanceId}: ${issues.join(', ')}`,
        `${recommendations.join(', ')}, NAT Gateway 또는 VPC 엔드포인트 사용 검토`
      );
    }
  }

  async checkSubnetAutoAssign(subnetId) {
    try {
      const subnets = await this.dataCollector.getSubnets([subnetId]);
      return subnets?.[0]?.MapPublicIpOnLaunch || false;
    } catch (error) {
      return false;
    }
  }

  getInstanceName(instance) {
    if (!instance.Tags) return null;
    
    const nameTag = instance.Tags.find(tag => tag.Key === 'Name');
    return nameTag ? nameTag.Value : null;
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

module.exports = PublicInstanceInspector;