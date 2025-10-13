/**
 * EC2 Stopped Instances Checker
 * 중지된 EC2 인스턴스를 검사하여 비용 최적화 기회를 찾습니다.
 * Requirements: 2.1 - EC2 비용 최적화 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');

class StoppedInstancesChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 인스턴스의 중지 상태 검사
   * @param {Array} instances - EC2 인스턴스 목록
   */
  async runAllChecks(instances) {
    const activeInstances = instances.filter(instance => 
      instance.State?.Name !== 'terminated'
    );

    if (activeInstances.length === 0) {
      // 인스턴스가 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    const stoppedInstances = activeInstances.filter(instance => 
      instance.State?.Name === 'stopped'
    );

    if (stoppedInstances.length === 0) {
      // 중지된 인스턴스가 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    for (const instance of stoppedInstances) {
      await this.checkStoppedInstance(instance);
    }
  }

  /**
   * 개별 중지된 인스턴스 검사
   * @param {Object} instance - EC2 인스턴스 정보
   */
  async checkStoppedInstance(instance) {
    const instanceName = this.getInstanceName(instance);
    const stoppedDuration = this.calculateStoppedDuration(instance);
    const stoppedDays = Math.floor(stoppedDuration / (24 * 60 * 60 * 1000));

    let riskLevel = 'LOW';
    let issue = `인스턴스 '${instanceName}'이 ${stoppedDays}일 동안 중지되어 있습니다`;
    let recommendation = '인스턴스가 더 이상 필요하지 않다면 종료를 고려하세요.';

    if (stoppedDays > 30) {
      // 30일 이상 중지된 경우
      riskLevel = 'MEDIUM';
      issue = `인스턴스 '${instanceName}'이 ${stoppedDays}일 동안 장기간 중지되어 있습니다`;
      recommendation = '장기간 사용하지 않는 인스턴스는 종료하여 EBS 스토리지 비용을 절약하세요. 필요시 AMI로 백업 후 종료하세요.';
    } else if (stoppedDays > 7) {
      // 7일 이상 중지된 경우
      riskLevel = 'LOW';
      issue = `인스턴스 '${instanceName}'이 ${stoppedDays}일 동안 중지되어 있습니다`;
      recommendation = '일주일 이상 사용하지 않는 인스턴스는 종료를 검토하세요. EBS 볼륨에 대한 스토리지 비용이 계속 발생합니다.';
    }

    // Elastic IP가 연결된 경우 추가 경고
    const hasElasticIp = instance.PublicIpAddress && 
                        instance.NetworkInterfaces?.some(ni => 
                          ni.Association?.AllocationId
                        );

    if (hasElasticIp) {
      riskLevel = 'MEDIUM';
      issue += ' (Elastic IP 연결됨)';
      recommendation = '중지된 인스턴스에 Elastic IP가 연결되어 있어 추가 비용이 발생합니다. ' + recommendation;
    }

    const finding = new InspectionFinding({
      resourceId: instance.InstanceId,
      resourceType: 'EC2Instance',
      riskLevel: riskLevel,
      issue: issue,
      recommendation: recommendation
    });

    this.inspector.addFinding(finding);
  }

  /**
   * 중지 기간 계산
   * @param {Object} instance - EC2 인스턴스
   * @returns {number} 중지 기간 (밀리초)
   */
  calculateStoppedDuration(instance) {
    const stateTransitionReason = instance.StateTransitionReason;
    const now = new Date();
    
    // StateTransitionReason에서 시간 추출 시도
    if (stateTransitionReason) {
      const timeMatch = stateTransitionReason.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC)\)/);
      if (timeMatch) {
        const stoppedTime = new Date(timeMatch[1]);
        return now - stoppedTime;
      }
    }

    // LaunchTime을 기준으로 추정 (정확하지 않지만 대략적인 값)
    if (instance.LaunchTime) {
      const launchTime = new Date(instance.LaunchTime);
      // 최소 1일은 중지되었다고 가정
      return Math.max(now - launchTime, 24 * 60 * 60 * 1000);
    }

    // 기본값: 1일
    return 24 * 60 * 60 * 1000;
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
  async check(ec2Client, instances) {
    const results = { findings: [] };
    await this.runAllChecks(instances);
    return results;
  }
}

module.exports = StoppedInstancesChecker;