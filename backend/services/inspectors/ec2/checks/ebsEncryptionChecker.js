/**
 * EC2 EBS Encryption Checker
 * EC2 인스턴스의 EBS 볼륨 암호화 상태를 검사합니다.
 * Requirements: 2.1 - EC2 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { DescribeVolumesCommand } = require('@aws-sdk/client-ec2');

class EBSEncryptionChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 인스턴스의 EBS 암호화 검사
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
      await this.checkInstanceEBSEncryption(instance);
    }
  }

  /**
   * 개별 인스턴스의 EBS 암호화 검사
   * @param {Object} instance - EC2 인스턴스 정보
   */
  async checkInstanceEBSEncryption(instance) {
    const instanceName = this.getInstanceName(instance);
    
    if (!instance.BlockDeviceMappings || instance.BlockDeviceMappings.length === 0) {
      // 볼륨이 없는 인스턴스
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
      const unencryptedVolumes = volumes.filter(volume => !volume.Encrypted);
      const encryptedVolumes = volumes.filter(volume => volume.Encrypted);

      if (unencryptedVolumes.length > 0) {
        // 암호화되지 않은 볼륨이 있는 경우
        const volumeList = unencryptedVolumes.map(v => v.VolumeId).join(', ');
        
        const finding = new InspectionFinding({
          resourceId: instance.InstanceId,
          resourceType: 'EC2Instance',
          riskLevel: 'HIGH',
          issue: `인스턴스 '${instanceName}'에 암호화되지 않은 EBS 볼륨이 있습니다: ${volumeList}`,
          recommendation: 'EBS 볼륨을 암호화하여 데이터 보안을 강화하세요. 새 암호화된 볼륨으로 교체하거나 스냅샷을 통해 암호화된 복사본을 생성하세요.'
        });
        this.inspector.addFinding(finding);
      } else {
        // 모든 볼륨이 암호화된 경우 Finding을 생성하지 않음 (PASS)
      }

    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: instance.InstanceId,
        resourceType: 'EC2Instance',
        riskLevel: 'MEDIUM',
        issue: `인스턴스 '${instanceName}'의 EBS 볼륨 암호화 상태를 확인할 수 없습니다: ${error.message}`,
        recommendation: 'EC2 권한을 확인하고 EBS 볼륨 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
    }
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

module.exports = EBSEncryptionChecker;