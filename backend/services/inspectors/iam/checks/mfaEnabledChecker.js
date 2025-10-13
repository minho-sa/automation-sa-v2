/**
 * IAM MFA Enabled Checker
 * IAM 사용자의 MFA(다중 인증) 설정을 검사합니다.
 * Requirements: 2.2 - IAM 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { 
  GetAccountSummaryCommand, 
  ListMFADevicesCommand, 
  GetLoginProfileCommand,
  GetCredentialReportCommand 
} = require('@aws-sdk/client-iam');

class MFAEnabledChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * MFA 설정 검사
   * @param {Array} users - IAM 사용자 목록
   */
  async runAllChecks(users) {
    const allUsers = users || [];

    if (allUsers.length === 0) {
      // 사용자가 없는 경우에도 루트 계정 MFA는 검사해야 함
      // 루트 계정 1개를 검사하는 것으로 간주
      this.inspector.incrementResourceCount(1);
      await this.checkRootMFA();
      return;
    }

    // 루트 계정 MFA 검사 (루트 계정 1개 추가)
    this.inspector.incrementResourceCount(1);
    await this.checkRootMFA();

    // 각 사용자의 MFA 설정 검사
    const usersWithoutMFA = [];
    const usersWithMFA = [];

    for (const user of allUsers) {
      const hasMFA = await this.checkUserMFA(user);
      if (hasMFA) {
        usersWithMFA.push(user);
      } else {
        usersWithoutMFA.push(user);
      }
    }

    // 전체 요약 보고
    await this.generateMFASummary(usersWithMFA, usersWithoutMFA);
  }

  /**
   * 루트 계정 MFA 검사
   */
  async checkRootMFA() {
    try {
      const iamClient = this.inspector.iamClient;
      
      // 계정 요약 정보를 통한 루트 MFA 확인
      const command = new GetAccountSummaryCommand({});
      const summaryResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetAccountSummary'
      );
      const summaryMap = summaryResponse.SummaryMap || {};
      
      const rootMFAEnabled = summaryMap.AccountMFAEnabled || 0;
      
      if (rootMFAEnabled === 0) {
        const finding = new InspectionFinding({
          resourceId: 'root-account-mfa',
          resourceType: 'IAMUser',
          riskLevel: 'CRITICAL',
          issue: '루트 계정에 MFA가 설정되어 있지 않습니다',
          recommendation: '루트 계정에 즉시 MFA를 설정하세요. 하드웨어 MFA 디바이스 사용을 권장합니다.'
        });
        this.inspector.addFinding(finding);
      } else {
        // 루트 계정에 MFA가 설정된 경우 Finding을 생성하지 않음 (PASS)
      }
      
    } catch (error) {
      // 오류 발생 시 Finding을 생성하지 않고 로그만 기록
      this.inspector.recordError(error, { operation: 'checkRootMFA' });
    }
  }

  /**
   * 개별 사용자 MFA 검사
   * @param {Object} user - IAM 사용자
   * @returns {boolean} MFA 설정 여부
   */
  async checkUserMFA(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      // 사용자의 MFA 디바이스 조회
      const command = new ListMFADevicesCommand({
        UserName: user.UserName
      });
      const mfaDevicesResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'ListMFADevices'
      );
      
      const mfaDevices = mfaDevicesResponse.MFADevices || [];
      
      if (mfaDevices.length === 0) {
        // 콘솔 액세스가 있는지 확인
        const hasConsoleAccess = await this.hasConsoleAccess(user);
        
        if (hasConsoleAccess) {
          const finding = new InspectionFinding({
            resourceId: user.UserName,
            resourceType: 'IAMUser',
            riskLevel: 'HIGH',
            issue: `콘솔 액세스가 있는 사용자 '${user.UserName}'에게 MFA가 설정되어 있지 않습니다`,
            recommendation: '콘솔 액세스가 있는 모든 사용자에게 MFA를 설정하세요.'
          });
          this.inspector.addFinding(finding);
        } else {
          const finding = new InspectionFinding({
            resourceId: user.UserName,
            resourceType: 'IAMUser',
            riskLevel: 'MEDIUM',
            issue: `사용자 '${user.UserName}'에게 MFA가 설정되어 있지 않습니다`,
            recommendation: '보안 강화를 위해 모든 사용자에게 MFA 설정을 권장합니다.'
          });
          this.inspector.addFinding(finding);
        }
        return false;
      } else {
        // MFA가 설정된 경우 디바이스 정보 확인
        for (const device of mfaDevices) {
          await this.analyzeMFADevice(user, device);
        }
        return true;
      }
      
    } catch (error) {
      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: 'MEDIUM',
        issue: `사용자 '${user.UserName}'의 MFA 설정을 확인할 수 없습니다: ${error.message}`,
        recommendation: 'IAM 권한을 확인하고 사용자의 MFA 설정을 검토하세요.'
      });
      this.inspector.addFinding(finding);
      return false;
    }
  }

  /**
   * 사용자의 콘솔 액세스 여부 확인
   * @param {Object} user - IAM 사용자
   * @returns {boolean} 콘솔 액세스 여부
   */
  async hasConsoleAccess(user) {
    try {
      const iamClient = this.inspector.iamClient;
      
      const command = new GetLoginProfileCommand({
        UserName: user.UserName
      });
      await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetLoginProfile'
      );
      
      return true; // 로그인 프로필이 있으면 콘솔 액세스 가능
    } catch (error) {
      if (error.Code === 'NoSuchEntity') {
        return false; // 로그인 프로필이 없으면 콘솔 액세스 불가
      }
      return false; // 오류 발생 시 안전하게 false 반환
    }
  }

  /**
   * MFA 디바이스 분석
   * @param {Object} user - IAM 사용자
   * @param {Object} device - MFA 디바이스
   */
  async analyzeMFADevice(user, device) {
    const deviceType = this.getMFADeviceType(device.SerialNumber);
    const enableDate = new Date(device.EnableDate);
    const now = new Date();
    const ageInDays = Math.floor((now - enableDate) / (1000 * 60 * 60 * 24));
    
    // MFA 디바이스 타입별 권장사항
    let riskLevel = 'PASS';
    
    if (deviceType === 'virtual' && ageInDays > 365) {
      // 1년 이상 된 가상 MFA 디바이스만 Finding 생성
      const finding = new InspectionFinding({
        resourceId: user.UserName,
        resourceType: 'IAMUser',
        riskLevel: 'LOW',
        issue: `사용자 '${user.UserName}'의 가상 MFA 디바이스가 1년 이상 사용되고 있습니다 (${ageInDays}일 전 설정)`,
        recommendation: '가상 MFA 디바이스가 1년 이상 사용되고 있습니다. 하드웨어 MFA 디바이스로 업그레이드를 고려하세요.'
      });
      this.inspector.addFinding(finding);
    }
    // 다른 경우들은 PASS이므로 Finding을 생성하지 않음
  }

  /**
   * MFA 디바이스 타입 확인
   * @param {string} serialNumber - MFA 디바이스 시리얼 번호
   * @returns {string} 디바이스 타입
   */
  getMFADeviceType(serialNumber) {
    if (serialNumber.startsWith('arn:aws:iam::')) {
      return 'virtual';
    } else {
      return 'hardware';
    }
  }

  /**
   * MFA 설정 요약 생성
   * @param {Array} usersWithMFA - MFA가 설정된 사용자 목록
   * @param {Array} usersWithoutMFA - MFA가 설정되지 않은 사용자 목록
   */
  async generateMFASummary(usersWithMFA, usersWithoutMFA) {
    const totalUsers = usersWithMFA.length + usersWithoutMFA.length;
    const mfaPercentage = totalUsers > 0 ? Math.round((usersWithMFA.length / totalUsers) * 100) : 0;
    
    // 요약성 Finding은 제거 - 개별 사용자와 루트 계정만 보고
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

module.exports = MFAEnabledChecker;