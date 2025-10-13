/**
 * IAM Unused Credentials Checker
 * 사용하지 않는 IAM 자격 증명을 검사합니다.
 * Requirements: 2.2 - IAM 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { 
  ListAccessKeysCommand,
  GetAccessKeyLastUsedCommand,
  GetLoginProfileCommand,
  ListServiceSpecificCredentialsCommand
} = require('@aws-sdk/client-iam');

class UnusedCredentialsChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 사용하지 않는 자격 증명 검사
   * @param {Array} users - IAM 사용자 목록
   */
  async runAllChecks(users) {
    const allUsers = users || [];

    if (allUsers.length === 0) {
      // 사용자가 없는 경우에도 검사가 수행되었음을 표시
      this.inspector.incrementResourceCount(1);
      return;
    }

    for (const user of allUsers) {
      await this.checkUserCredentials(user);
    }
  }

  /**
   * 개별 사용자의 자격 증명 검사
   * @param {Object} user - IAM 사용자 정보
   */
  async checkUserCredentials(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      // 액세스 키 검사
      await this.checkAccessKeys(user);
      
      // 로그인 프로필 검사 (콘솔 패스워드)
      await this.checkLoginProfile(user);
      
      // 서비스별 자격 증명 검사
      await this.checkServiceSpecificCredentials(user);
      
    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: 'MEDIUM',
        issue: `사용자 '${user.UserName}'의 자격 증명을 확인할 수 없습니다: ${error.message}`,
        recommendation: 'IAM 권한을 확인하고 사용자 자격 증명 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
    }
  }

  /**
   * 액세스 키 검사
   * @param {Object} user - IAM 사용자
   */
  async checkAccessKeys(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new ListAccessKeysCommand({
        UserName: user.UserName
      });
      const accessKeysResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'ListAccessKeys'
      );
      
      const accessKeys = accessKeysResponse.AccessKeyMetadata || [];
      
      if (accessKeys.length === 0) {
        // 액세스 키가 없는 경우 Finding을 생성하지 않음 (PASS)
        return;
      }

      for (const accessKey of accessKeys) {
        await this.analyzeAccessKey(user, accessKey);
      }
      
    } catch (error) {
      // 액세스 키 조회 실패는 무시 (권한 부족일 수 있음)
    }
  }

  /**
   * 개별 액세스 키 분석
   * @param {Object} user - IAM 사용자
   * @param {Object} accessKey - 액세스 키 메타데이터
   */
  async analyzeAccessKey(user, accessKey) {
    const now = new Date();
    const createDate = new Date(accessKey.CreateDate);
    const ageInDays = Math.floor((now - createDate) / (1000 * 60 * 60 * 24));
    
    // 액세스 키 상태 확인
    if (accessKey.Status === 'Inactive') {
      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: 'LOW',
        issue: `사용자 '${user.UserName}'에게 비활성화된 액세스 키가 있습니다 (${accessKey.AccessKeyId})`,
        recommendation: '사용하지 않는 비활성화된 액세스 키를 삭제하세요.'
      });
      this.inspector.addFinding(finding);
      return;
    }

    // 오래된 액세스 키 확인
    if (ageInDays > 90) {
      let riskLevel = 'MEDIUM';
      let recommendation = '액세스 키를 정기적으로 로테이션하세요 (권장: 90일마다).';
      
      if (ageInDays > 365) {
        riskLevel = 'HIGH';
        recommendation = '1년 이상 된 액세스 키는 보안 위험이 높습니다. 즉시 로테이션하세요.';
      }

      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: riskLevel,
        issue: `사용자 '${user.UserName}'의 액세스 키가 ${ageInDays}일 동안 로테이션되지 않았습니다`,
        recommendation: recommendation
      });
      this.inspector.addFinding(finding);
    }

    // 최근 사용 여부 확인 (가능한 경우)
    try {
      const iamClient = this.inspector.iamClient;
      const command = new GetAccessKeyLastUsedCommand({
        AccessKeyId: accessKey.AccessKeyId
      });
      const lastUsedResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetAccessKeyLastUsed'
      );
      
      const lastUsed = lastUsedResponse.AccessKeyLastUsed;
      if (lastUsed && lastUsed.LastUsedDate) {
        const lastUsedDate = new Date(lastUsed.LastUsedDate);
        const daysSinceLastUse = Math.floor((now - lastUsedDate) / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastUse > 90) {
          const finding = new InspectionFinding({
            resourceId: user.UserName,
            resourceType: 'IAMUser',
            riskLevel: 'MEDIUM',
            issue: `사용자 '${user.UserName}'의 액세스 키가 ${daysSinceLastUse}일 동안 사용되지 않았습니다`,
            recommendation: '사용하지 않는 액세스 키를 삭제하거나 비활성화하세요.'
          });
          this.inspector.addFinding(finding);
        }
      } else {
        // 한 번도 사용되지 않은 액세스 키
        if (ageInDays > 7) {
          const finding = new InspectionFinding({
            resourceId: user.UserName,
            resourceType: 'IAMUser',
            riskLevel: 'MEDIUM',
            issue: `사용자 '${user.UserName}'의 액세스 키가 생성 후 한 번도 사용되지 않았습니다`,
            recommendation: '사용하지 않는 액세스 키를 삭제하세요.'
          });
          this.inspector.addFinding(finding);
        }
      }
    } catch (error) {
      // 마지막 사용 정보 조회 실패는 무시
    }
  }

  /**
   * 로그인 프로필 검사 (콘솔 패스워드)
   * @param {Object} user - IAM 사용자
   */
  async checkLoginProfile(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new GetLoginProfileCommand({
        UserName: user.UserName
      });
      const loginProfileResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetLoginProfile'
      );
      
      const loginProfile = loginProfileResponse.LoginProfile;
      if (loginProfile) {
        const createDate = new Date(loginProfile.CreateDate);
        const now = new Date();
        const ageInDays = Math.floor((now - createDate) / (1000 * 60 * 60 * 24));
        
        if (ageInDays > 90) {
          const finding = new InspectionFinding({
            resourceId: user.UserName,
            resourceType: 'IAMUser',
            riskLevel: 'MEDIUM',
            issue: `사용자 '${user.UserName}'의 콘솔 패스워드가 ${ageInDays}일 동안 변경되지 않았습니다`,
            recommendation: '정기적으로 패스워드를 변경하고 강력한 패스워드 정책을 적용하세요.'
          });
          this.inspector.addFinding(finding);
        }
        
        // 패스워드 재설정 필요 여부 확인
        if (loginProfile.PasswordResetRequired) {
          const finding = new InspectionFinding({
            resourceId: user.UserName,
            resourceType: 'IAMUser',
            riskLevel: 'HIGH',
            issue: `사용자 '${user.UserName}'에게 패스워드 재설정이 필요합니다`,
            recommendation: '사용자가 다음 로그인 시 패스워드를 변경하도록 설정되어 있습니다.'
          });
          this.inspector.addFinding(finding);
        }
      }
      
    } catch (error) {
      if (error.Code === 'NoSuchEntity') {
        // 콘솔 액세스가 없는 사용자 - 정상
        // 콘솔 액세스가 없는 경우 Finding을 생성하지 않음 (PASS)
      }
    }
  }

  /**
   * 서비스별 자격 증명 검사
   * @param {Object} user - IAM 사용자
   */
  async checkServiceSpecificCredentials(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new ListServiceSpecificCredentialsCommand({
        UserName: user.UserName
      });
      const credentialsResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'ListServiceSpecificCredentials'
      );
      
      const credentials = credentialsResponse.ServiceSpecificCredentials || [];
      
      if (credentials.length > 0) {
        for (const credential of credentials) {
          const createDate = new Date(credential.CreateDate);
          const now = new Date();
          const ageInDays = Math.floor((now - createDate) / (1000 * 60 * 60 * 24));
          
          if (credential.Status === 'Inactive') {
            const finding = new InspectionFinding({
              resourceId: user.UserName,
              resourceType: 'IAMUser',
              riskLevel: 'LOW',
              issue: `사용자 '${user.UserName}'에게 비활성화된 ${credential.ServiceName} 자격 증명이 있습니다`,
              recommendation: '사용하지 않는 서비스별 자격 증명을 삭제하세요.'
            });
            this.inspector.addFinding(finding);
          } else if (ageInDays > 90) {
            const finding = new InspectionFinding({
              resourceId: user.UserName,
              resourceType: 'IAMUser',
              riskLevel: 'MEDIUM',
              issue: `사용자 '${user.UserName}'의 ${credential.ServiceName} 자격 증명이 ${ageInDays}일 동안 로테이션되지 않았습니다`,
              recommendation: '서비스별 자격 증명을 정기적으로 로테이션하세요.'
            });
            this.inspector.addFinding(finding);
          }
        }
      }
      
    } catch (error) {
      // 서비스별 자격 증명 조회 실패는 무시
    }
  }

  /**
   * 기존 check 메서드 (하위 호환성)
   */
  async check(iamClient, users) {
    const results = { findings: [] };
    await this.runAllChecks(users);
    return results;
  }
}

module.exports = UnusedCredentialsChecker;