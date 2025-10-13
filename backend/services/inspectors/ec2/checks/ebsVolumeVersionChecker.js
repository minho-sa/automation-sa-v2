/**
 * EBS Volume Version Checker
 * EBS 볼륨의 타입과 버전을 검사하여 성능 최적화 기회를 찾습니다.
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { DescribeVolumesCommand } = require('@aws-sdk/client-ec2');

class EBSVolumeVersionChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 인스턴스의 EBS 볼륨 버전 검사
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

    for (const instance of activeInstances) {
      await this.checkInstanceEBSVolumes(instance);
    }
  }

  /**
   * 개별 인스턴스의 EBS 볼륨 검사
   * @param {Object} instance - EC2 인스턴스 정보
   */
  async checkInstanceEBSVolumes(instance) {
    const instanceName = this.getInstanceName(instance);
    
    if (!instance.BlockDeviceMappings || instance.BlockDeviceMappings.length === 0) {
      // EBS 볼륨이 없는 경우 Finding을 생성하지 않음 (PASS)
      return;
    }

    const ec2Client = this.inspector.ec2Client;
    const volumeIds = instance.BlockDeviceMappings
      .filter(mapping => mapping.Ebs?.VolumeId)
      .map(mapping => mapping.Ebs.VolumeId);

    if (volumeIds.length === 0) {
      return;
    }

    try {
      // 볼륨 정보 조회
      const command = new DescribeVolumesCommand({
        VolumeIds: volumeIds
      });
      
      const volumesResponse = await this.inspector.retryableApiCall(
        () => ec2Client.send(command),
        'DescribeVolumes'
      );

      const volumes = volumesResponse.Volumes || [];
      const legacyVolumes = [];
      const modernVolumes = [];

      // 볼륨 타입 분석
      volumes.forEach(volume => {
        const volumeType = volume.VolumeType;
        
        if (volumeType === 'gp2' || volumeType === 'io1' || volumeType === 'standard') {
          legacyVolumes.push({
            volumeId: volume.VolumeId,
            volumeType: volumeType,
            size: volume.Size,
            iops: volume.Iops
          });
        } else if (volumeType === 'gp3' || volumeType === 'io2') {
          modernVolumes.push({
            volumeId: volume.VolumeId,
            volumeType: volumeType,
            size: volume.Size,
            iops: volume.Iops
          });
        }
      });

      if (legacyVolumes.length > 0) {
        // 레거시 볼륨이 있는 경우
        const volumeList = legacyVolumes.map(v => `${v.volumeId}(${v.volumeType})`).join(', ');
        
        let riskLevel = 'LOW';
        let recommendation = 'gp3 또는 io2와 같은 최신 볼륨 타입으로 업그레이드를 고려하세요.';
        
        // gp2에서 gp3로의 업그레이드 권장
        const gp2Volumes = legacyVolumes.filter(v => v.volumeType === 'gp2');
        if (gp2Volumes.length > 0) {
          riskLevel = 'MEDIUM';
          recommendation = 'gp2 볼륨을 gp3로 업그레이드하면 더 나은 성능과 비용 효율성을 얻을 수 있습니다.';
        }
        
        // 표준 볼륨은 더 높은 우선순위
        const standardVolumes = legacyVolumes.filter(v => v.volumeType === 'standard');
        if (standardVolumes.length > 0) {
          riskLevel = 'HIGH';
          recommendation = '표준 볼륨은 성능이 제한적입니다. gp3 볼륨으로 즉시 업그레이드하세요.';
        }

        const finding = new InspectionFinding({
          resourceId: instance.InstanceId,
          resourceType: 'EC2Instance',
          riskLevel: riskLevel,
          issue: `인스턴스 '${instanceName}'에서 레거시 EBS 볼륨 타입이 사용되고 있습니다: ${volumeList}`,
          recommendation: recommendation
        });
        this.inspector.addFinding(finding);
      } else if (modernVolumes.length > 0) {
        // 최신 볼륨만 사용하는 경우 Finding을 생성하지 않음 (PASS)
      }

      // 고성능 인스턴스에 대한 추가 권장사항
      if (this.isHighPerformanceInstance(instance) && legacyVolumes.length > 0) {
        const finding = new InspectionFinding({
          resourceId: instance.InstanceId,
          resourceType: 'EC2Instance',
          riskLevel: 'MEDIUM',
          issue: `고성능 인스턴스 '${instanceName}'에서 레거시 볼륨을 사용하여 성능 병목이 발생할 수 있습니다`,
          recommendation: '고성능 인스턴스의 잠재력을 최대화하기 위해 io2 또는 gp3 볼륨으로 업그레이드하세요.'
        });
        this.inspector.addFinding(finding);
      }

    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: instance.InstanceId,
        resourceType: 'EC2Instance',
        riskLevel: 'MEDIUM',
        issue: `인스턴스 '${instanceName}'의 EBS 볼륨 정보를 확인할 수 없습니다: ${error.message}`,
        recommendation: 'EC2 권한을 확인하고 EBS 볼륨 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
    }
  }

  /**
   * 고성능 인스턴스 여부 판단
   * @param {Object} instance - EC2 인스턴스
   * @returns {boolean} 고성능 인스턴스 여부
   */
  isHighPerformanceInstance(instance) {
    const instanceType = instance.InstanceType || '';
    
    // 고성능 인스턴스 패밀리
    const highPerformanceFamilies = [
      'c5', 'c5n', 'c6i', 'c6a',  // 컴퓨팅 최적화
      'm5', 'm5n', 'm6i', 'm6a',  // 범용 (대형)
      'r5', 'r5n', 'r6i', 'r6a',  // 메모리 최적화
      'i3', 'i4i',                // 스토리지 최적화
      'p3', 'p4',                 // GPU 인스턴스
      'x1', 'x2'                  // 고메모리
    ];
    
    return highPerformanceFamilies.some(family => instanceType.startsWith(family));
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

module.exports = EBSVolumeVersionChecker;