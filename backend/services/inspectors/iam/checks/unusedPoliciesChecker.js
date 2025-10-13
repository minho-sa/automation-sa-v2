/**
 * IAM Unused Policies Checker
 * 사용되지 않는 IAM 정책 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { ListEntitiesForPolicyCommand } = require('@aws-sdk/client-iam');

class UnusedPoliciesChecker {
  constructor(inspector) {
    this.inspector = inspector;
    this.logger = inspector.logger;
  }

  /**
   * 모든 미사용 정책 검사 실행
   */
  async runAllChecks(users, roles, policies) {
    try {
      this.logger.debug('Starting unused policies checks');

      // 검사가 수행되었음을 표시하기 위해 최소 1개의 리소스 카운트 설정
      // 실제 정책 수가 있으면 그 수를 사용하고, 없으면 1개로 설정
      const resourceCount = Math.max(1, (policies?.length || 0));
      this.inspector.incrementResourceCount(resourceCount);

      await this.checkUnusedPolicies(users, roles, policies);

      this.logger.debug('Completed unused policies checks');
    } catch (error) {
      this.logger.error('Error in unused policies checks:', error);
      this.inspector.recordError(error, {
        phase: 'unusedPoliciesCheck',
        context: 'UnusedPoliciesChecker.runAllChecks'
      });
      throw error;
    }
  }

  /**
   * 미사용 정책 검사
   */
  async checkUnusedPolicies(users, roles, policies) {
    this.logger.debug(`Checking unused policies: ${policies?.length || 0} total policies`);
    
    if (!policies || policies.length === 0) {
      this.logger.debug('No policies found, skipping unused policies check');
      return;
    }

    // 사용자 관리형 정책만 검사 (AWS 관리형 정책 제외)
    const customerManagedPolicies = policies.filter(policy =>
      !policy.Arn.includes('aws:policy/')
    );

    this.logger.debug(`Found ${customerManagedPolicies.length} customer managed policies`);

    if (customerManagedPolicies.length === 0) {
      this.logger.debug('No customer managed policies found, skipping unused policies check');
      return;
    }

    // 각 정책의 사용 여부를 실제 AWS API로 확인
    let unusedCount = 0;
    for (const policy of customerManagedPolicies) {
      this.logger.debug(`Checking policy: ${policy.PolicyName} (${policy.Arn})`);
      const isUsed = await this.isPolicyUsed(policy, users, roles);
      this.logger.debug(`Policy ${policy.PolicyName} is used: ${isUsed}`);
      
      if (!isUsed) {
        unusedCount++;
        await this.reportUnusedPolicy(policy);
      }
    }
    
    this.logger.debug(`Found ${unusedCount} unused policies out of ${customerManagedPolicies.length} customer managed policies`);
  }

  /**
   * 사용하지 않는 정책 찾기
   * @param {Array} policies - 고객 관리형 정책 목록
   * @param {Array} users - IAM 사용자 목록
   * @param {Array} roles - IAM 역할 목록
   * @returns {Array} 사용하지 않는 정책 목록
   */
  async findUnusedPolicies(policies, users, roles) {
    const unusedPolicies = [];

    for (const policy of policies) {
      const isUsed = await this.isPolicyUsed(policy, users, roles);
      if (!isUsed) {
        unusedPolicies.push(policy);
      }
    }

    return unusedPolicies;
  }

  /**
   * 정책 사용 여부 확인
   * @param {Object} policy - IAM 정책
   * @param {Array} users - IAM 사용자 목록
   * @param {Array} roles - IAM 역할 목록
   * @returns {boolean} 사용 여부
   */
  async isPolicyUsed(policy, users, roles) {
    try {
      const iamClient = this.inspector.iamClient;

      // 정책이 연결된 엔티티 조회
      const command = new ListEntitiesForPolicyCommand({
        PolicyArn: policy.Arn
      });
      const entitiesResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'ListEntitiesForPolicy'
      );

      const entities = entitiesResponse;

      // 사용자, 역할, 그룹 중 하나라도 연결되어 있으면 사용 중
      return (entities.PolicyUsers && entities.PolicyUsers.length > 0) ||
        (entities.PolicyRoles && entities.PolicyRoles.length > 0) ||
        (entities.PolicyGroups && entities.PolicyGroups.length > 0);

    } catch (error) {
      // 오류 발생 시 사용 중인 것으로 간주 (안전한 접근)
      return true;
    }
  }

  /**
   * 사용하지 않는 정책 보고
   * @param {Object} policy - 사용하지 않는 정책
   */
  async reportUnusedPolicy(policy) {
    const createdDate = new Date(policy.CreateDate);
    const now = new Date();
    const ageInDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

    let riskLevel = 'LOW';
    let recommendation = '사용하지 않는 정책을 검토하고 필요하지 않다면 삭제하세요.';

    if (ageInDays > 90) {
      riskLevel = 'MEDIUM';
      recommendation = '90일 이상 사용하지 않는 정책입니다. 삭제를 고려하세요.';
    }

    if (ageInDays > 365) {
      riskLevel = 'MEDIUM';
      recommendation = '1년 이상 사용하지 않는 정책입니다. 즉시 삭제하는 것을 권장합니다.';
    }

    const finding = new InspectionFinding({
      resourceId: policy.PolicyName,
      resourceType: 'IAMPolicy',
      riskLevel: riskLevel,
      issue: `정책 '${policy.PolicyName}'이 ${ageInDays}일 동안 사용되지 않고 있습니다`,
      recommendation: recommendation
    });

    this.inspector.addFinding(finding);
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(iamClient, users, roles, policies) {
    const results = { findings: [] };
    await this.runAllChecks(users, roles, policies);
    return results;
  }
}

module.exports = UnusedPoliciesChecker;