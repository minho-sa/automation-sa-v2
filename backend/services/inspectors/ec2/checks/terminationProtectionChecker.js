/**
 * EC2 Termination Protection Checker
 * EC2 인스턴스의 종료 보호 설정을 검사합니다.
 * Requirements: 2.1 - EC2 운영 안정성 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { DescribeInstanceAttributeCommand } = require('@aws-sdk/client-ec2');

class TerminationProtectionChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 인스턴스의 종료 보호 설정 검사
   * @param {Array} instances - EC2 인스턴스 목록
   */
  async runAllChecks(instances) {
    const activeInstances = instances.filter(instance => 
      instance.State?.Name === 'running' || instance.State?.Name === 'stopped'
    );

    if (activeInstances.length === 0) {
      // 인스턴스가 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    for (const instance of activeInstances) {
      await this.checkInstanceTerminationProtection(instance);
    }
  }

  /**
   * 개별 인스턴스의 종료 보호 설정 검사
   * @param {Object} instance - EC2 인스턴스 정보
   */
  async checkInstanceTerminationProtection(instance) {
    const instanceName = this.getInstanceName(instance);
    const environment = this.getInstanceEnvironment(instance);
    const isProduction = environment === 'production';
    const isCritical = this.isCriticalInstance(instance);

    try {
      const ec2Client = this.inspector.ec2Client;
      
      // 종료 보호 상태 조회
      const command = new DescribeInstanceAttributeCommand({
        InstanceId: instance.InstanceId,
        Attribute: 'disableApiTermination'
      });
      const response = await this.inspector.retryableApiCall(
        () => ec2Client.send(command),
        'DescribeInstanceAttribute'
      );

      const terminationProtectionEnabled = response.DisableApiTermination?.Value || false;

      if (isProduction || isCritical) {
        // 프로덕션 또는 중요한 인스턴스
        if (!terminationProtectionEnabled) {
          const finding = new InspectionFinding({
            resourceId: instance.InstanceId,
            resourceType: 'EC2Instance',
            riskLevel: 'HIGH',
            issue: `중요한 인스턴스 '${instanceName}'에 종료 보호가 비활성화되어 있습니다`,
            recommendation: '실수로 인한 종료를 방지하기 위해 종료 보호를 즉시 활성화하세요.'
          });
          this.inspector.addFinding(finding);
        } else {
          // 중요한 인스턴스에 종료 보호가 활성화된 경우 Finding을 생성하지 않음 (PASS)
        }
      } else {
        // 일반 인스턴스
        if (terminationProtectionEnabled) {
          // 일반 인스턴스에 종료 보호가 활성화된 경우 Finding을 생성하지 않음 (PASS)
        } else {
          const finding = new InspectionFinding({
            resourceId: instance.InstanceId,
            resourceType: 'EC2Instance',
            riskLevel: 'LOW',
            issue: `인스턴스 '${instanceName}'에 종료 보호가 비활성화되어 있습니다`,
            recommendation: '중요한 데이터가 있는 경우 종료 보호 활성화를 고려하세요.'
          });
          this.inspector.addFinding(finding);
        }
      }

    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: instance.InstanceId,
        resourceType: 'EC2Instance',
        riskLevel: 'MEDIUM',
        issue: `인스턴스 '${instanceName}'의 종료 보호 설정을 확인할 수 없습니다: ${error.message}`,
        recommendation: 'EC2 권한을 확인하고 인스턴스 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
    }
  }

  /**
   * 인스턴스 환경 판단
   * @param {Object} instance - EC2 인스턴스
   * @returns {string} 환경 (production, staging, development)
   */
  getInstanceEnvironment(instance) {
    const environmentTag = instance.Tags?.find(tag => 
      tag.Key.toLowerCase().includes('env') || 
      tag.Key.toLowerCase().includes('environment')
    );
    
    if (environmentTag) {
      const value = environmentTag.Value.toLowerCase();
      if (value.includes('prod')) return 'production';
      if (value.includes('stag')) return 'staging';
      if (value.includes('dev') || value.includes('test')) return 'development';
    }

    // 인스턴스 이름으로 추정
    const instanceName = this.getInstanceName(instance).toLowerCase();
    if (instanceName.includes('prod')) return 'production';
    if (instanceName.includes('stag')) return 'staging';
    if (instanceName.includes('dev') || instanceName.includes('test')) return 'development';

    return 'unknown';
  }

  /**
   * 중요한 인스턴스 여부 판단
   * @param {Object} instance - EC2 인스턴스
   * @returns {boolean} 중요한 인스턴스 여부
   */
  isCriticalInstance(instance) {
    const instanceName = this.getInstanceName(instance).toLowerCase();
    const criticalKeywords = ['prod', 'production', 'master', 'primary', 'db', 'database'];
    
    return criticalKeywords.some(keyword => instanceName.includes(keyword));
  }

  /**
   * 인스턴스 이름 가져오기
   * @param {Object} instance - EC2 인스턴스
   * @returns {string} 인스턴스 이름
   */
  getInstanceName(instance) {
    const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
    return nameTag?.Value || instance.InstanceId;
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(ec2Client, securityGroups, instances) {
    const results = { findings: [] };
    await this.runAllChecks(securityGroups, instances);
    return results;
  }
}

module.exports = TerminationProtectionChecker;