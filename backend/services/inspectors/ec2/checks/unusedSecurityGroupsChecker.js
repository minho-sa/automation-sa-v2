/**
 * EC2 Unused Security Groups Checker
 * 사용하지 않는 보안 그룹을 검사하여 비용 최적화 기회를 찾습니다.
 * Requirements: 2.1 - EC2 비용 최적화 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');

class UnusedSecurityGroupsChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 사용하지 않는 보안 그룹 검사
   * @param {Array} securityGroups - 보안 그룹 목록
   * @param {Array} instances - EC2 인스턴스 목록
   */
  async runAllChecks(securityGroups, instances) {
    if (!securityGroups || securityGroups.length === 0) {
      // 보안 그룹이 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    const activeInstances = instances?.filter(instance => 
      instance.State?.Name !== 'terminated'
    ) || [];

    // 인스턴스에서 사용 중인 보안 그룹 ID 수집
    const usedSecurityGroupIds = new Set();
    activeInstances.forEach(instance => {
      instance.SecurityGroups?.forEach(sg => {
        usedSecurityGroupIds.add(sg.GroupId);
      });
    });

    // 사용하지 않는 보안 그룹 찾기 (default 제외)
    const unusedSecurityGroups = securityGroups.filter(sg => 
      !usedSecurityGroupIds.has(sg.GroupId) && sg.GroupName !== 'default'
    );

    if (unusedSecurityGroups.length === 0) {
      // 모든 보안 그룹이 사용 중인 경우 Finding을 생성하지 않음 (PASS)
      return;
    }

    // 사용하지 않는 보안 그룹들에 대한 finding 생성
    for (const sg of unusedSecurityGroups) {
      const finding = new InspectionFinding({
        resourceId: sg.GroupId,
        resourceType: 'SecurityGroup',
        riskLevel: 'LOW',
        issue: `보안 그룹 '${sg.GroupName}'이 사용되지 않고 있습니다`,
        recommendation: '사용하지 않는 보안 그룹을 삭제하여 관리 복잡성을 줄이세요. 삭제 전 다른 리소스에서 참조하지 않는지 확인하세요.'
      });
      this.inspector.addFinding(finding);
    }

    // 전체 요약 finding
    if (unusedSecurityGroups.length > 5) {
      const finding = new InspectionFinding({
        resourceId: 'many-unused-security-groups',
        resourceType: 'SecurityGroup',
        riskLevel: 'MEDIUM',
        issue: `${unusedSecurityGroups.length}개의 보안 그룹이 사용되지 않고 있습니다`,
        recommendation: '대량의 미사용 보안 그룹이 발견되었습니다. 보안 그룹 관리 정책을 수립하고 정기적인 정리 작업을 수행하세요.'
      });
      this.inspector.addFinding(finding);
    }
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

module.exports = UnusedSecurityGroupsChecker;