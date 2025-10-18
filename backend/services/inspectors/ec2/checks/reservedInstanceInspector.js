const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class ReservedInstanceInspector extends BaseInspector {
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

      const reservedInstances = await this.dataCollector.getReservedInstances();
      const runningInstances = await this.dataCollector.getEC2Instances();
      
      if (!Array.isArray(reservedInstances)) {
        this.addFinding('reserved-instances', 'ReservedInstance', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('예약 인스턴스 데이터 형식 오류');
      }

      if (!Array.isArray(runningInstances)) {
        this.addFinding('instances', 'EC2Instance', '데이터 형식 오류', '데이터 구조 확인');
        throw new Error('인스턴스 데이터 형식 오류');
      }
      
      await this.checkReservedInstances(reservedInstances, runningInstances);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'reserved-instances',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkReservedInstances(reservedInstances, runningInstances) {
    let hasFormatError = false;
    const formatErrors = new Set();
    
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    
    // 인스턴스 타입별 사용량 계산
    const instanceUsage = this.calculateInstanceUsage(runningInstances);
    
    for (const ri of reservedInstances) {
      this.incrementResourceCount();
      
      const validation = this.validateReservedInstanceFormat(ri);
      if (!validation.valid) {
        if (!hasFormatError) {
          formatErrors.add(validation.error);
          hasFormatError = true;
        }
        continue;
      }
      
      await this.performReservedInstanceCheck(ri, instanceUsage, now, thirtyDaysFromNow);
    }
    
    if (hasFormatError) {
      this.addFinding('format-error', 'System', 
        `데이터 형식 오류: ${Array.from(formatErrors).join(', ')}`, 
        '데이터 구조 확인');
    }
  }

  calculateInstanceUsage(instances) {
    const usage = {};
    
    for (const instance of instances) {
      if (instance.State?.Name !== 'running') continue;
      
      const key = `${instance.InstanceType}-${instance.Placement?.AvailabilityZone}`;
      usage[key] = (usage[key] || 0) + 1;
    }
    
    return usage;
  }

  validateReservedInstanceFormat(ri) {
    if (!ri || typeof ri !== 'object') {
      return { valid: false, error: '예약 인스턴스가 객체가 아님' };
    }
    
    const requiredFields = ['ReservedInstancesId', 'InstanceType', 'State', 'End'];
    const missingFields = requiredFields.filter(field => !ri[field]);
    
    if (missingFields.length > 0) {
      return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
    }
    
    return { valid: true };
  }

  async performReservedInstanceCheck(ri, instanceUsage, now, thirtyDaysFromNow) {
    if (ri.State !== 'active') return;
    
    const endDate = new Date(ri.End);
    const riKey = `${ri.InstanceType}-${ri.AvailabilityZone}`;
    const currentUsage = instanceUsage[riKey] || 0;
    const reservedCount = ri.InstanceCount || 1;
    
    // 30일 이내 만료 검사
    if (endDate <= thirtyDaysFromNow) {
      const daysUntilExpiry = Math.ceil((endDate - now) / (24 * 60 * 60 * 1000));
      this.addFinding(
        ri.ReservedInstancesId,
        'ReservedInstance',
        `예약 인스턴스가 ${daysUntilExpiry}일 후 만료됩니다`,
        '만료 전 갱신 또는 새로운 예약 인스턴스 구매를 검토하세요'
      );
    }
    
    // 사용률 검사
    if (currentUsage === 0) {
      this.addFinding(
        ri.ReservedInstancesId,
        'ReservedInstance',
        `예약 인스턴스가 사용되지 않고 있습니다 (${ri.InstanceType})`,
        '해당 타입의 인스턴스를 실행하거나 예약 인스턴스 수정/교환을 고려하세요'
      );
    } else if (currentUsage < reservedCount) {
      const underUtilization = ((reservedCount - currentUsage) / reservedCount * 100).toFixed(1);
      this.addFinding(
        ri.ReservedInstancesId,
        'ReservedInstance',
        `예약 인스턴스 사용률이 낮습니다 (${underUtilization}% 미사용)`,
        '추가 인스턴스 실행 또는 예약 인스턴스 수정을 고려하세요'
      );
    } else if (currentUsage > reservedCount) {
      const overUsage = currentUsage - reservedCount;
      this.addFinding(
        ri.ReservedInstancesId,
        'ReservedInstance',
        `예약 인스턴스보다 ${overUsage}개 더 많은 인스턴스가 실행 중입니다`,
        '추가 예약 인스턴스 구매를 통한 비용 절감을 고려하세요'
      );
    }
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

module.exports = ReservedInstanceInspector;