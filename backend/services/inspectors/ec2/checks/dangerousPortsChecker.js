/**
 * EC2 Dangerous Ports Checker
 * 보안 그룹의 위험한 포트 노출을 검사합니다.
 * Requirements: 2.1 - EC2 보안 그룹 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');

class DangerousPortsChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 모든 보안 그룹의 위험한 포트 검사
   * @param {Array} securityGroups - 보안 그룹 목록
   */
  async runAllChecks(securityGroups) {
    if (!securityGroups || securityGroups.length === 0) {
      // 보안 그룹이 없는 경우 Finding을 생성하지 않음 (실제 리소스가 아니므로)
      return;
    }

    for (const securityGroup of securityGroups) {
      await this.checkSecurityGroupPorts(securityGroup);
    }
  }

  /**
   * 개별 보안 그룹의 위험한 포트 검사
   * @param {Object} securityGroup - 보안 그룹 정보
   */
  async checkSecurityGroupPorts(securityGroup) {
    if (!securityGroup.IpPermissions || securityGroup.IpPermissions.length === 0) {
      // 규칙이 없는 보안 그룹 - 안전함
      // 인바운드 규칙이 없는 경우 Finding을 생성하지 않음 (PASS)
      return;
    }

    const dangerousRules = [];
    const issues = [];

    // 각 규칙 검사
    for (const rule of securityGroup.IpPermissions) {
      const ruleAnalysis = this.analyzeRule(rule);
      if (ruleAnalysis.isDangerous) {
        dangerousRules.push(ruleAnalysis);
        issues.push(ruleAnalysis.issue);
      }
    }

    // 위험한 규칙이 있는 경우에만 Finding 생성
    if (dangerousRules.length > 0) {
      // 가장 높은 위험도 결정
      const criticalRules = dangerousRules.filter(r => r.riskLevel === 'CRITICAL');
      const highRules = dangerousRules.filter(r => r.riskLevel === 'HIGH');
      
      let riskLevel, issue, recommendation;
      
      if (criticalRules.length > 0) {
        riskLevel = 'CRITICAL';
        issue = `보안 그룹 '${securityGroup.GroupName}'에서 심각한 포트 노출: ${issues.join(', ')}`;
        recommendation = '즉시 SSH/RDP 포트를 특정 IP로 제한하고 불필요한 규칙을 제거하세요.';
      } else if (highRules.length > 0) {
        riskLevel = 'HIGH';
        issue = `보안 그룹 '${securityGroup.GroupName}'에서 위험한 포트 노출: ${issues.join(', ')}`;
        recommendation = '위험한 포트들을 특정 IP로 제한하거나 제거하세요.';
      } else {
        riskLevel = 'MEDIUM';
        issue = `보안 그룹 '${securityGroup.GroupName}'에서 중간 위험 포트 노출: ${issues.join(', ')}`;
        recommendation = '노출된 포트들을 검토하고 필요시 접근을 제한하세요.';
      }

      const finding = new InspectionFinding({
        resourceId: securityGroup.GroupId,
        resourceType: 'SecurityGroup',
        riskLevel: riskLevel,
        issue: issue,
        recommendation: recommendation
      });

      this.inspector.addFinding(finding);
    }
    // 위험한 규칙이 없는 경우 Finding을 생성하지 않음 (PASS)
  }

  /**
   * 개별 규칙 분석
   * @param {Object} rule - 보안 그룹 규칙
   * @returns {Object} 분석 결과
   */
  analyzeRule(rule) {
    const fromPort = rule.FromPort;
    const toPort = rule.ToPort;
    const protocol = rule.IpProtocol;
    
    // 0.0.0.0/0 (인터넷 전체) 접근 확인
    const hasPublicAccess = rule.IpRanges?.some(range => range.CidrIp === '0.0.0.0/0') ||
                           rule.Ipv6Ranges?.some(range => range.CidrIpv6 === '::/0');

    if (!hasPublicAccess) {
      return { isDangerous: false };
    }

    // 위험한 포트 정의
    const dangerousPorts = {
      22: { service: 'SSH', riskLevel: 'CRITICAL' },
      3389: { service: 'RDP', riskLevel: 'CRITICAL' },
      23: { service: 'Telnet', riskLevel: 'CRITICAL' },
      21: { service: 'FTP', riskLevel: 'HIGH' },
      3306: { service: 'MySQL', riskLevel: 'HIGH' },
      5432: { service: 'PostgreSQL', riskLevel: 'HIGH' },
      1433: { service: 'SQL Server', riskLevel: 'HIGH' },
      27017: { service: 'MongoDB', riskLevel: 'HIGH' },
      6379: { service: 'Redis', riskLevel: 'HIGH' },
      5984: { service: 'CouchDB', riskLevel: 'MEDIUM' },
      8080: { service: 'HTTP Alt', riskLevel: 'MEDIUM' },
      9200: { service: 'Elasticsearch', riskLevel: 'MEDIUM' }
    };

    // 단일 포트 검사
    if (fromPort === toPort && dangerousPorts[fromPort]) {
      const portInfo = dangerousPorts[fromPort];
      return {
        isDangerous: true,
        port: fromPort,
        service: portInfo.service,
        riskLevel: portInfo.riskLevel,
        issue: `${portInfo.service} 포트(${fromPort})가 인터넷 전체에 개방됨`
      };
    }

    // 포트 범위 검사
    if (fromPort !== toPort) {
      const portRange = toPort - fromPort + 1;
      if (portRange > 100) {
        return {
          isDangerous: true,
          port: `${fromPort}-${toPort}`,
          service: 'Port Range',
          riskLevel: 'HIGH',
          issue: `과도한 포트 범위(${fromPort}-${toPort})가 인터넷에 개방됨`
        };
      }

      // 범위 내 위험한 포트 확인
      for (const [port, info] of Object.entries(dangerousPorts)) {
        const portNum = parseInt(port);
        if (portNum >= fromPort && portNum <= toPort) {
          return {
            isDangerous: true,
            port: `${fromPort}-${toPort}`,
            service: `Range including ${info.service}`,
            riskLevel: info.riskLevel,
            issue: `포트 범위(${fromPort}-${toPort})에 위험한 ${info.service} 포트(${port}) 포함`
          };
        }
      }
    }

    // 모든 포트 개방 (0-65535)
    if (fromPort === 0 && toPort === 65535) {
      return {
        isDangerous: true,
        port: '0-65535',
        service: 'All Ports',
        riskLevel: 'CRITICAL',
        issue: '모든 포트(0-65535)가 인터넷 전체에 개방됨'
      };
    }

    return { isDangerous: false };
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(ec2Client, securityGroups) {
    const results = { findings: [] };
    await this.runAllChecks(securityGroups);
    return results;
  }
}

module.exports = DangerousPortsChecker;