const BaseInspector = require('../../baseInspector');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');

class InstanceTypeOptimizationInspector extends BaseInspector {
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
      this.cloudWatchClient = new CloudWatchClient({
        region: awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });

      await this.preInspectionValidation(awsCredentials, inspectionConfig);
      const instances = await this.dataCollector.getEC2Instances();
      
      if (!Array.isArray(instances)) {
        this.addFinding('instances', 'EC2Instance', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('데이터 형식 오류');
      }
      
      await this.checkInstanceOptimization(instances);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async preInspectionValidation(awsCredentials, inspectionConfig) {
    const { EC2Client } = require('@aws-sdk/client-ec2');
    const EC2DataCollector = require('../collectors/ec2DataCollector');
    
    this.ec2Client = new EC2Client({
      region: awsCredentials.region || 'us-east-1',
      credentials: {
        accessKeyId: awsCredentials.accessKeyId,
        secretAccessKey: awsCredentials.secretAccessKey,
        sessionToken: awsCredentials.sessionToken
      }
    });
    this.dataCollector = new EC2DataCollector(this.ec2Client, this);
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'instance-type-optimization',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkInstanceOptimization(instances) {
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
      
      if (instance.State?.Name !== 'running') continue;
      
      await this.analyzeInstanceUtilization(instance);
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
    
    const requiredFields = ['InstanceId', 'InstanceType'];
    const missingFields = requiredFields.filter(field => !instance[field]);
    
    if (missingFields.length > 0) {
      return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
    }
    
    return { valid: true };
  }

  async analyzeInstanceUtilization(instance) {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 7일 전
      
      const cpuUtilization = await this.getCPUUtilization(instance.InstanceId, startTime, endTime);
      
      if (cpuUtilization === null) return;
      
      if (cpuUtilization < 10) {
        this.addFinding(
          instance.InstanceId,
          'EC2Instance',
          `CPU 사용률이 낮음 (평균 ${cpuUtilization.toFixed(1)}%)`,
          `인스턴스 타입을 더 작은 크기로 다운사이징하여 비용을 절약하세요. 현재 타입: ${instance.InstanceType}`
        );
      } else if (cpuUtilization > 80) {
        this.addFinding(
          instance.InstanceId,
          'EC2Instance',
          `CPU 사용률이 높음 (평균 ${cpuUtilization.toFixed(1)}%)`,
          `인스턴스 타입을 더 큰 크기로 업그레이드하여 성능을 개선하세요. 현재 타입: ${instance.InstanceType}`
        );
      }
    } catch (error) {
      this.recordError(error, { context: `인스턴스 ${instance.InstanceId} 분석` });
    }
  }

  async getCPUUtilization(instanceId, startTime, endTime) {
    try {
      const command = new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [
          {
            Name: 'InstanceId',
            Value: instanceId
          }
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 3600, // 1시간
        Statistics: ['Average']
      });

      const response = await this.retryableApiCall(
        () => this.cloudWatchClient.send(command),
        'GetMetricStatistics'
      );

      if (!response.Datapoints || response.Datapoints.length === 0) {
        return null;
      }

      const averageUtilization = response.Datapoints.reduce((sum, point) => sum + point.Average, 0) / response.Datapoints.length;
      return averageUtilization;
    } catch (error) {
      this.recordError(error, { context: `CloudWatch 지표 조회: ${instanceId}` });
      return null;
    }
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'UnauthorizedOperation':
        this.addFinding('system', 'Permission', 'AWS 권한 부족', 'CloudWatch 및 EC2 읽기 권한 확인');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'AWS API 호출' });
    }
  }
}

module.exports = InstanceTypeOptimizationInspector;