/**
 * IAM Inline Policies Checker
 * IAM 인라인 정책 사용을 검사합니다.
 * Requirements: 2.2 - IAM 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { 
  ListUserPoliciesCommand,
  ListRolePoliciesCommand,
  GetUserPolicyCommand,
  GetRolePolicyCommand
} = require('@aws-sdk/client-iam');

class InlinePoliciesChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 인라인 정책 검사
   * @param {Array} users - IAM 사용자 목록
   * @param {Array} roles - IAM 역할 목록
   */
  async runAllChecks(users, roles) {
    const allUsers = users || [];
    const allRoles = roles || [];

    if (allUsers.length === 0 && allRoles.length === 0) {
      // 사용자나 역할이 없는 경우에도 검사가 수행되었음을 표시
      this.inspector.incrementResourceCount(1);
      return;
    }

    // 검사할 리소스 수 설정 (사용자 + 역할)
    this.inspector.incrementResourceCount(allUsers.length + allRoles.length);

    let totalInlinePolicies = 0;
    let entitiesWithInlinePolicies = 0;

    // 사용자 인라인 정책 검사
    for (const user of allUsers) {
      const userInlineCount = await this.checkUserInlinePolicies(user);
      if (userInlineCount > 0) {
        totalInlinePolicies += userInlineCount;
        entitiesWithInlinePolicies++;
      }
    }

    // 역할 인라인 정책 검사
    for (const role of allRoles) {
      const roleInlineCount = await this.checkRoleInlinePolicies(role);
      if (roleInlineCount > 0) {
        totalInlinePolicies += roleInlineCount;
        entitiesWithInlinePolicies++;
      }
    }

    // 전체 요약 생성
    await this.generateInlinePolicySummary(totalInlinePolicies, entitiesWithInlinePolicies, allUsers.length + allRoles.length);
  }

  /**
   * 사용자 인라인 정책 검사
   * @param {Object} user - IAM 사용자
   * @returns {number} 인라인 정책 개수
   */
  async checkUserInlinePolicies(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new ListUserPoliciesCommand({
        UserName: user.UserName
      });
      const inlinePoliciesResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'ListUserPolicies'
      );
      
      const inlinePolicies = inlinePoliciesResponse.PolicyNames || [];
      
      if (inlinePolicies.length === 0) {
        // 인라인 정책이 없는 경우 Finding을 생성하지 않음 (PASS)
        return 0;
      }

      // 각 인라인 정책 분석
      for (const policyName of inlinePolicies) {
        await this.analyzeUserInlinePolicy(user, policyName);
      }

      // 사용자별 인라인 정책 요약
      let riskLevel = 'MEDIUM';
      if (inlinePolicies.length > 3) {
        riskLevel = 'HIGH';
      }

      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: riskLevel,
        issue: `사용자 '${user.UserName}'에게 ${inlinePolicies.length}개의 인라인 정책이 있습니다`,
        recommendation: '인라인 정책을 관리형 정책으로 변환하여 재사용성과 관리 효율성을 높이세요.'
      });
      this.inspector.addFinding(finding);

      return inlinePolicies.length;
      
    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: 'MEDIUM',
        issue: `사용자 '${user.UserName}'의 인라인 정책을 확인할 수 없습니다: ${error.message}`,
        recommendation: 'IAM 권한을 확인하고 사용자 정책 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
      return 0;
    }
  }

  /**
   * 역할 인라인 정책 검사
   * @param {Object} role - IAM 역할
   * @returns {number} 인라인 정책 개수
   */
  async checkRoleInlinePolicies(role) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new ListRolePoliciesCommand({
        RoleName: role.RoleName
      });
      const inlinePoliciesResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'ListRolePolicies'
      );
      
      const inlinePolicies = inlinePoliciesResponse.PolicyNames || [];
      
      if (inlinePolicies.length === 0) {
        // 인라인 정책이 없는 경우 Finding을 생성하지 않음 (PASS)
        return 0;
      }

      // 각 인라인 정책 분석
      for (const policyName of inlinePolicies) {
        await this.analyzeRoleInlinePolicy(role, policyName);
      }

      // 역할별 인라인 정책 요약
      let riskLevel = 'MEDIUM';
      if (inlinePolicies.length > 5) {
        riskLevel = 'HIGH';
      }

      const finding = new InspectionFinding({
        resourceId: role.RoleName,
        resourceType: 'IAMRole',
        riskLevel: riskLevel,
        issue: `역할 '${role.RoleName}'에 ${inlinePolicies.length}개의 인라인 정책이 있습니다`,
        recommendation: '인라인 정책을 관리형 정책으로 변환하여 재사용성과 관리 효율성을 높이세요.'
      });
      this.inspector.addFinding(finding);

      return inlinePolicies.length;
      
    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: role.RoleName,
        resourceType: 'IAMRole',
        riskLevel: 'MEDIUM',
        issue: `역할 '${role.RoleName}'의 인라인 정책을 확인할 수 없습니다: ${error.message}`,
        recommendation: 'IAM 권한을 확인하고 역할 정책 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
      return 0;
    }
  }

  /**
   * 사용자 인라인 정책 분석
   * @param {Object} user - IAM 사용자
   * @param {string} policyName - 정책 이름
   */
  async analyzeUserInlinePolicy(user, policyName) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new GetUserPolicyCommand({
        UserName: user.UserName,
        PolicyName: policyName
      });
      const policyResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetUserPolicy'
      );
      
      const policyDocument = JSON.parse(decodeURIComponent(policyResponse.PolicyDocument));
      const analysis = this.analyzePolicyDocument(policyDocument);
      
      if (analysis.hasHighRiskPermissions) {
        const finding = new InspectionFinding({
          resourceId: user.UserName,
          resourceType: 'IAMUser',
          riskLevel: 'HIGH',
          issue: `사용자 '${user.UserName}'의 인라인 정책 '${policyName}'에 위험한 권한이 있습니다`,
          recommendation: '위험한 권한을 제거하고 최소 권한 원칙을 적용하세요. 관리형 정책으로 변환을 고려하세요.'
        });
        this.inspector.addFinding(finding);
      }
      
      if (analysis.isOverlyBroad) {
        const finding = new InspectionFinding({
          resourceId: user.UserName,
          resourceType: 'IAMUser',
          riskLevel: 'MEDIUM',
          issue: `사용자 '${user.UserName}'의 인라인 정책 '${policyName}'이 과도하게 광범위한 권한을 부여합니다`,
          recommendation: '정책을 더 구체적으로 제한하고 필요한 권한만 부여하세요.'
        });
        this.inspector.addFinding(finding);
      }
      
    } catch (error) {
      // 개별 정책 분석 실패는 무시
    }
  }

  /**
   * 역할 인라인 정책 분석
   * @param {Object} role - IAM 역할
   * @param {string} policyName - 정책 이름
   */
  async analyzeRoleInlinePolicy(role, policyName) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new GetRolePolicyCommand({
        RoleName: role.RoleName,
        PolicyName: policyName
      });
      const policyResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetRolePolicy'
      );
      
      const policyDocument = JSON.parse(decodeURIComponent(policyResponse.PolicyDocument));
      const analysis = this.analyzePolicyDocument(policyDocument);
      
      if (analysis.hasHighRiskPermissions) {
        const finding = new InspectionFinding({
          resourceId: role.RoleName,
          resourceType: 'IAMRole',
          riskLevel: 'HIGH',
          issue: `역할 '${role.RoleName}'의 인라인 정책 '${policyName}'에 위험한 권한이 있습니다`,
          recommendation: '위험한 권한을 제거하고 최소 권한 원칙을 적용하세요. 관리형 정책으로 변환을 고려하세요.'
        });
        this.inspector.addFinding(finding);
      }
      
      if (analysis.isOverlyBroad) {
        const finding = new InspectionFinding({
          resourceId: role.RoleName,
          resourceType: 'IAMRole',
          riskLevel: 'MEDIUM',
          issue: `역할 '${role.RoleName}'의 인라인 정책 '${policyName}'이 과도하게 광범위한 권한을 부여합니다`,
          recommendation: '정책을 더 구체적으로 제한하고 필요한 권한만 부여하세요.'
        });
        this.inspector.addFinding(finding);
      }
      
    } catch (error) {
      // 개별 정책 분석 실패는 무시
    }
  }

  /**
   * 정책 문서 분석
   * @param {Object} policyDocument - 정책 문서
   * @returns {Object} 분석 결과
   */
  analyzePolicyDocument(policyDocument) {
    const statements = policyDocument.Statement || [];
    let hasHighRiskPermissions = false;
    let isOverlyBroad = false;
    
    for (const statement of statements) {
      if (statement.Effect === 'Allow') {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
        
        // 위험한 액션 확인
        const dangerousActions = actions.filter(action => 
          action === '*' ||
          action.includes('iam:*') ||
          action.includes('sts:AssumeRole') ||
          action.includes('*:*')
        );
        
        if (dangerousActions.length > 0) {
          hasHighRiskPermissions = true;
        }
        
        // 과도하게 광범위한 권한 확인
        const broadActions = actions.filter(action => action.includes('*'));
        const broadResources = resources.filter(resource => resource === '*');
        
        if (broadActions.length > 0 && broadResources.length > 0) {
          isOverlyBroad = true;
        }
      }
    }
    
    return { hasHighRiskPermissions, isOverlyBroad };
  }

  /**
   * 인라인 정책 요약 생성
   * @param {number} totalInlinePolicies - 전체 인라인 정책 수
   * @param {number} entitiesWithInlinePolicies - 인라인 정책이 있는 엔티티 수
   * @param {number} totalEntities - 전체 엔티티 수
   */
  async generateInlinePolicySummary(totalInlinePolicies, entitiesWithInlinePolicies, totalEntities) {
    // 요약성 Finding은 제거 - 개별 사용자/역할의 인라인 정책만 보고
    return;
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(iamClient, users, roles) {
    const results = { findings: [] };
    await this.runAllChecks(users, roles);
    return results;
  }
}

module.exports = InlinePoliciesChecker;