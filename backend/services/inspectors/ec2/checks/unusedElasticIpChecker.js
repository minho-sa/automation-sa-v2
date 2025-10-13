/**
 * Unused Elastic IP Checker
 * 미사용 Elastic IP를 검사하는 모듈
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { DescribeAddressesCommand } = require('@aws-sdk/client-ec2');

class UnusedElasticIpChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 사용하지 않는 Elastic IP 검사
   * @param {Array} instances - EC2 인스턴스 목록
   */
  async runAllChecks(instances) {
    try {
      const ec2Client = this.inspector.ec2Client;
      
      // 모든 Elastic IP 조회
      const command = new DescribeAddressesCommand({});
      const addressesResponse = await this.inspector.retryableApiCall(
        () => ec2Client.send(command),
        'DescribeAddresses'
      );
      
      const elasticIps = addressesResponse.Addresses || [];

      if (elasticIps.length === 0) {
        // Elastic IP가 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
        return;
      }

      const activeInstances = instances?.filter(instance => 
        instance.State?.Name !== 'terminated'
      ) || [];

      for (const eip of elasticIps) {
        await this.checkElasticIp(eip, activeInstances);
      }

    } catch (error) {
      // 오류 발생 시 Finding을 생성하지 않고 로그만 기록
      this.inspector.recordError(error, { operation: 'checkUnusedElasticIps' });
    }
  }

  /**
   * 개별 Elastic IP 검사
   * @param {Object} eip - Elastic IP 정보
   * @param {Array} instances - EC2 인스턴스 목록
   */
  async checkElasticIp(eip, instances) {
    const publicIp = eip.PublicIp;
    const instanceId = eip.InstanceId;
    const associationId = eip.AssociationId;

    if (!instanceId && !associationId) {
      // 연결되지 않은 Elastic IP
      const finding = new InspectionFinding({
        resourceId: eip.AllocationId || publicIp,
        resourceType: 'ElasticIP',
        riskLevel: 'MEDIUM',
        issue: `Elastic IP '${publicIp}'가 어떤 리소스에도 연결되지 않았습니다`,
        recommendation: '사용하지 않는 Elastic IP를 즉시 해제하여 시간당 요금을 절약하세요.'
      });
      this.inspector.addFinding(finding);
      return;
    }

    if (instanceId) {
      // 인스턴스에 연결된 Elastic IP
      const instance = instances.find(i => i.InstanceId === instanceId);
      
      if (!instance) {
        const finding = new InspectionFinding({
          resourceId: eip.AllocationId || publicIp,
          resourceType: 'ElasticIP',
          riskLevel: 'HIGH',
          issue: `Elastic IP '${publicIp}'가 존재하지 않는 인스턴스 '${instanceId}'에 연결되어 있습니다`,
          recommendation: '존재하지 않는 인스턴스에 연결된 Elastic IP를 해제하세요.'
        });
        this.inspector.addFinding(finding);
        return;
      }

      const instanceName = this.getInstanceName(instance);
      
      if (instance.State?.Name === 'stopped') {
        // 중지된 인스턴스에 연결된 Elastic IP
        const finding = new InspectionFinding({
          resourceId: eip.AllocationId || publicIp,
          resourceType: 'ElasticIP',
          riskLevel: 'MEDIUM',
          issue: `Elastic IP '${publicIp}'가 중지된 인스턴스 '${instanceName}'에 연결되어 있습니다`,
          recommendation: '중지된 인스턴스에 연결된 Elastic IP는 추가 비용이 발생합니다. 인스턴스를 시작하거나 IP를 해제하세요.'
        });
        this.inspector.addFinding(finding);
      } else if (instance.State?.Name === 'running') {
        // 실행 중인 인스턴스에 연결된 Elastic IP - Finding을 생성하지 않음 (PASS)
      }
    } else if (associationId) {
      // 다른 리소스에 연결된 경우 Finding을 생성하지 않음 (PASS)
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

module.exports = UnusedElasticIpChecker;