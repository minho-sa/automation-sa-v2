/**
 * Old Snapshots Checker
 * 오래된 EBS 스냅샷을 검사하는 모듈
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { DescribeSnapshotsCommand } = require('@aws-sdk/client-ec2');

class OldSnapshotsChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 오래된 스냅샷 검사
   * @param {Array} instances - EC2 인스턴스 목록
   */
  async runAllChecks(instances) {
    try {
      const ec2Client = this.inspector.ec2Client;

      // 계정의 모든 스냅샷 조회 (소유자만)
      const command = new DescribeSnapshotsCommand({
        OwnerIds: ['self']
      });

      const snapshotsResponse = await this.inspector.retryableApiCall(
        () => ec2Client.send(command),
        'DescribeSnapshots'
      );

      const snapshots = snapshotsResponse.Snapshots || [];

      if (snapshots.length === 0) {
        // 스냅샷이 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
        return;
      }

      const now = new Date();
      const oldSnapshots = [];
      const veryOldSnapshots = [];

      // 스냅샷 분류
      snapshots.forEach(snapshot => {
        const startTime = new Date(snapshot.StartTime);
        const ageInDays = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));

        if (ageInDays > 365) {
          veryOldSnapshots.push({ ...snapshot, ageInDays });
        } else if (ageInDays > 90) {
          oldSnapshots.push({ ...snapshot, ageInDays });
        }
      });

      // 요약성 Finding은 제거 - 개별 스냅샷만 보고

      // 개별 오래된 스냅샷들 모두 보고 (실제 리소스만)
      const allOldSnapshots = [...veryOldSnapshots, ...oldSnapshots]
        .sort((a, b) => b.ageInDays - a.ageInDays);

      for (const snapshot of allOldSnapshots) {
        let riskLevel = 'LOW';
        if (snapshot.ageInDays > 365) {
          riskLevel = 'MEDIUM';
        }
        
        const finding = new InspectionFinding({
          resourceId: snapshot.SnapshotId,
          resourceType: 'EBSSnapshot',
          riskLevel: riskLevel,
          issue: `스냅샷 '${snapshot.SnapshotId}'이 ${snapshot.ageInDays}일 동안 보관되고 있습니다 (${snapshot.VolumeSize}GB)`,
          recommendation: '장기간 보관된 스냅샷이 여전히 필요한지 검토하고, 불필요하다면 삭제하세요.'
        });
        this.inspector.addFinding(finding);
      }

    } catch (error) {
      // 오류 발생 시 Finding을 생성하지 않고 로그만 기록
      this.inspector.recordError(error, { operation: 'checkOldSnapshots' });
    }
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

module.exports = OldSnapshotsChecker;