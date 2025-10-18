/**
 * EC2 Security Group Inspector
 * EC2DataCollector를 활용한 보안그룹 검사
 */

const BaseInspector = require('../../baseInspector');
const { EC2Client } = require('@aws-sdk/client-ec2');
const EC2DataCollector = require('../collectors/ec2DataCollector');

class SecurityGroupInspector extends BaseInspector {
  constructor() {
    super('EC2');
    this.ec2Client = null;
    this.dataCollector = null;
    
    // 성능 최적화: 위험한 포트 배열을 미리 변환
    this.dangerousPortsArray = [
      { port: 22, service: 'SSH' },
      { port: 3389, service: 'RDP' },
      { port: 23, service: 'Telnet' },
      { port: 21, service: 'FTP' },
      { port: 3306, service: 'MySQL' },
      { port: 5432, service: 'PostgreSQL' }
    ];
  }

  /**
   * API 호출 재시도 로직
   */
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

  /**
   * 에러 기록
   */
  recordError(error, context = {}) {
    console.error(`[SecurityGroupInspector] Error:`, {
      message: error.message,
      context,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * InspectionService 호환용 메서드
   */
  async executeItemInspection(customerId, inspectionId, awsCredentials, inspectionConfig) {
    const findings = await this.executeInspection(awsCredentials, inspectionConfig);
    
    return [{
      serviceType: this.serviceType,
      itemId: inspectionConfig.targetItem || inspectionConfig.targetItemId || 'security-groups',
      findings: findings,
      inspectionTime: Date.now(),
      resourcesScanned: this.resourcesScanned
    }];
  }

  /**
   * 실제 검사 수행
   */
  async performInspection(awsCredentials, inspectionConfig) {
    try {
      // 1. AWS 클라이언트 초기화
      this.ec2Client = new EC2Client({
        region: awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.accessKeyId,
          secretAccessKey: awsCredentials.secretAccessKey,
          sessionToken: awsCredentials.sessionToken
        }
      });

      this.dataCollector = new EC2DataCollector(this.ec2Client, this);

      // 2. 보안그룹 수집
      const collector = {
        collect: () => this.dataCollector.getSecurityGroups()
      };

      const result = await this.collectAndValidate(collector, null);
      
      if (result.status === 'SUCCESS') {
        // 데이터 형식 검증 및 검사
        if (!Array.isArray(result.data)) {
          this.addFinding(
            'security-groups',
            'SecurityGroup',
            '보안그룹 데이터 형식 오류: 배열이 아님',
            '보안그룹 데이터 구조를 확인하세요'
          );
          throw new Error('보안그룹 데이터 형식 오류');
        }
        await this.checkSecurityGroups(result.data);
      } else if (result.status === 'ERROR') {
        this.handleAWSError(result.error);
        throw new Error(`Security Group 수집 실패: ${result.reason}`);
      } else {
        console.log(`[SecurityGroupInspector] Skipping inspection: ${result.reason}`);
      }
    } catch (error) {
      this.handleAWSError(error);
      throw error;
    }
  }

  /**
   * 보안그룹들 검사
   */
  async checkSecurityGroups(securityGroups) {
    let hasFormatError = false;
    const formatErrors = new Set();
    
    for (const sg of securityGroups) {
      this.incrementResourceCount();
      
      // 보안그룹 데이터 형식 검증
      const validation = this.validateSecurityGroupFormat(sg);
      if (!validation.valid) {
        if (!hasFormatError) {
          formatErrors.add(validation.error);
          hasFormatError = true;
        }
        continue;
      }
      
      await this.checkDangerousPorts(sg);
    }
    
    // 형식 오류가 있었다면 한 번만 기록
    if (hasFormatError) {
      this.addFinding(
        'security-groups-format',
        'SecurityGroup',
        `보안그룹 데이터 형식 오류 발견: ${Array.from(formatErrors).join(', ')}`,
        '보안그룹 데이터 구조를 확인하세요'
      );
    }
  }

  /**
   * 보안그룹 데이터 형식 검증
   */
  validateSecurityGroupFormat(sg) {
    const missingFields = [];
    
    if (!sg || typeof sg !== 'object') {
      this.logger.error('Security group validation failed: not an object', { sg });
      return { valid: false, error: '보안그룹이 객체가 아님' };
    }
    
    if (!sg.GroupId) missingFields.push('GroupId');
    if (!sg.GroupName) missingFields.push('GroupName');
    if (!sg.IpPermissions) missingFields.push('IpPermissions');
    
    if (missingFields.length > 0) {
      return { valid: false, error: `필수 필드 누락: ${missingFields.join(', ')}` };
    }
    
    if (!Array.isArray(sg.IpPermissions)) {
      return { valid: false, error: 'IpPermissions가 배열이 아님' };
    }
    
    // IpPermissions 규칙 형식 검증
    for (let i = 0; i < sg.IpPermissions.length; i++) {
      const ruleValidation = this.validateRuleFormat(sg.IpPermissions[i]);
      if (!ruleValidation.valid) {
        return { valid: false, error: `규칙 ${i}: ${ruleValidation.error}` };
      }
    }
    
    return { valid: true };
  }

  /**
   * 규칙 데이터 형식 검증
   */
  validateRuleFormat(rule) {
    if (!rule || typeof rule !== 'object') {
      return { valid: false, error: '규칙이 객체가 아님' };
    }
    
    // FromPort/ToPort는 실제 검사에서 undefined 체크로 처리하므로 검증 생략
    
    // IpRanges 검증 (실제 검사에서 사용)
    if (rule.IpRanges && !Array.isArray(rule.IpRanges)) {
      return { valid: false, error: 'IpRanges가 배열이 아님' };
    }
    
    if (rule.IpRanges) {
      for (let i = 0; i < rule.IpRanges.length; i++) {
        const range = rule.IpRanges[i];
        if (!range || typeof range !== 'object') {
          return { valid: false, error: `IpRanges[${i}]가 객체가 아님` };
        }
        if (!range.hasOwnProperty('CidrIp')) {
          return { valid: false, error: `IpRanges[${i}]에 CidrIp 필드 누락` };
        }
      }
    }
    
    return { valid: true };
  }

  /**
   * AWS 에러 처리
   */
  handleAWSError(error) {
    if (!error) return;
    
    switch (error.name) {
      case 'UnauthorizedOperation':
        this.addFinding(
          'security-groups',
          'SecurityGroup',
          'AWS 권한 부족: DescribeSecurityGroups 권한이 필요합니다',
          'IAM 정책에 ec2:DescribeSecurityGroups 권한을 추가하세요'
        );
        break;
      case 'InvalidUserID.NotFound':
        this.addFinding(
          'security-groups',
          'SecurityGroup',
          'AWS 계정 정보를 찾을 수 없습니다',
          'AWS 계정 ID와 역할 ARN을 확인하세요'
        );
        break;
      case 'TokenRefreshRequired':
      case 'ExpiredToken':
        this.addFinding(
          'security-groups',
          'SecurityGroup',
          'AWS 인증 토큰이 만료되었습니다',
          'AWS 자격 증명을 갱신하세요'
        );
        break;
      default:
        this.recordError(error, { context: 'AWS API 호출' });
    }
  }

  /**
   * 위험한 포트 검사 (성능 최적화)
   */
  async checkDangerousPorts(securityGroup) {
    if (!securityGroup.IpPermissions?.length) return;

    const issues = [];

    for (const rule of securityGroup.IpPermissions) {
      const hasPublicAccess = rule.IpRanges?.some(range => range.CidrIp === '0.0.0.0/0');
      
      if (!hasPublicAccess) continue;
      
      const fromPort = rule.FromPort;
      const toPort = rule.ToPort;

      // 포트 정보가 없으면 건너뛰기
      if (fromPort === undefined || toPort === undefined) continue;

      // 성능 최적화: 미리 변환된 배열 사용
      for (const { port, service } of this.dangerousPortsArray) {
        if (fromPort === toPort) {
          // 단일 포트 검사
          if (port === fromPort) {
            issues.push(`${service} 포트(${port})`);
          }
        } else {
          // 포트 범위 검사
          if (port >= fromPort && port <= toPort) {
            issues.push(`${service} 포트(${port}) 포함 범위(${fromPort}-${toPort})`);
            break;
          }
        }
      }
    }

    if (issues.length > 0) {
      this.addFinding(
        securityGroup.GroupId,
        'SecurityGroup',
        `보안그룹 '${securityGroup.GroupName}'에서 위험한 포트가 인터넷에 개방됨: ${issues.join(', ')}`,
        '위험한 포트들을 특정 IP로 제한하거나 제거하세요.'
      );
    }
  }
}

module.exports = SecurityGroupInspector;