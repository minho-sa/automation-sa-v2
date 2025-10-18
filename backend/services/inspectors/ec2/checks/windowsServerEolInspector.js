const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class WindowsServerEolInspector extends BaseInspector {
  constructor() {
    super('EC2');
    
    // Windows Server 버전별 지원 종료 날짜 (연장 지원 종료 기준)
    this.windowsServerEolDates = {
      '2008': new Date('2020-01-14'),
      '2008 R2': new Date('2020-01-14'),
      '2012': new Date('2023-10-10'),
      '2012 R2': new Date('2023-10-10'),
      '2016': new Date('2027-01-12'),
      '2019': new Date('2029-01-09'),
      '2022': new Date('2031-10-14')
    };
    
    // 경고 임계값 (지원 종료 6개월 전)
    this.warningThresholdMonths = 6;
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
      
      await this.checkWindowsServerInstances(instances);
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || 'windows-server-eol',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  async checkWindowsServerInstances(instances) {
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
      
      await this.checkWindowsServerVersion(instance);
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

  async checkWindowsServerVersion(instance) {
    // Windows 플랫폼이 아닌 경우 건너뛰기 (Platform 필드가 없으면 Linux)
    if (!instance.Platform || instance.Platform !== 'windows') {
      return;
    }

    const instanceId = instance.InstanceId;
    const imageName = instance.ImageId || '';
    
    // AMI 이름에서 Windows Server 버전 추출
    const windowsVersion = this.extractWindowsServerVersion(imageName, instance);
    
    if (!windowsVersion) {
      return; // Windows Server가 아니거나 버전을 확인할 수 없는 경우
    }

    const eolDate = this.windowsServerEolDates[windowsVersion];
    if (!eolDate) {
      return; // 알려지지 않은 버전
    }

    const currentDate = new Date();
    const warningDate = new Date(eolDate);
    warningDate.setMonth(warningDate.getMonth() - this.warningThresholdMonths);

    // 이미 지원이 종료된 경우
    if (currentDate > eolDate) {
      this.addFinding(
        instanceId,
        'EC2Instance',
        `Windows Server ${windowsVersion} 지원 종료됨 (${eolDate.toLocaleDateString('ko-KR')})`,
        `지원되는 Windows Server 버전으로 업그레이드하거나 인스턴스를 교체하세요`
      );
      return;
    }

    // 지원 종료가 임박한 경우
    if (currentDate > warningDate) {
      const daysUntilEol = Math.ceil((eolDate - currentDate) / (1000 * 60 * 60 * 24));
      this.addFinding(
        instanceId,
        'EC2Instance',
        `Windows Server ${windowsVersion} 지원 종료 임박 (${daysUntilEol}일 후: ${eolDate.toLocaleDateString('ko-KR')})`,
        `지원 종료 전에 새로운 Windows Server 버전으로 마이그레이션 계획을 수립하세요`
      );
    }
  }

  extractWindowsServerVersion(imageName, instance) {
    // AMI 이름이나 태그에서 Windows Server 버전 추출
    const imageDescription = instance.ImageDescription || '';
    const combinedText = `${imageName} ${imageDescription}`.toLowerCase();

    // Windows Server 버전 패턴 매칭
    const versionPatterns = [
      { pattern: /windows.*server.*2022/i, version: '2022' },
      { pattern: /windows.*server.*2019/i, version: '2019' },
      { pattern: /windows.*server.*2016/i, version: '2016' },
      { pattern: /windows.*server.*2012.*r2/i, version: '2012 R2' },
      { pattern: /windows.*server.*2012/i, version: '2012' },
      { pattern: /windows.*server.*2008.*r2/i, version: '2008 R2' },
      { pattern: /windows.*server.*2008/i, version: '2008' }
    ];

    for (const { pattern, version } of versionPatterns) {
      if (pattern.test(combinedText)) {
        return version;
      }
    }

    return null;
  }

  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'UnauthorizedOperation':
        this.addFinding('system', 'Permission', 'AWS 권한 부족', 'EC2 인스턴스 조회 권한 확인');
        break;
      case 'ExpiredToken':
        this.addFinding('system', 'Auth', '토큰 만료', '자격 증명 갱신');
        break;
      default:
        this.recordError(error, { context: 'Windows Server EOL 검사' });
    }
  }
}

module.exports = WindowsServerEolInspector;