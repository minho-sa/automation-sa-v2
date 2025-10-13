/**
 * IAM Root Access Key Checker
 * 루트 계정의 액세스 키 사용을 검사합니다.
 * Requirements: 2.2 - IAM 보안 설정 검사
 */

const InspectionFinding = require('../../../../models/InspectionFinding');
const { 
  GetAccountSummaryCommand, 
  GetCredentialReportCommand 
} = require('@aws-sdk/client-iam');

class RootAccessKeyChecker {
  constructor(inspector) {
    this.inspector = inspector;
  }

  /**
   * 루트 액세스 키 검사
   * @param {Array} users - IAM 사용자 목록 (실제로는 사용하지 않음)
   */
  async runAllChecks(users) {
    try {
      this.inspector.logger.debug('Starting root access key checks');
      
      // 루트 계정 검사는 항상 1개의 리소스(루트 계정)를 검사하는 것으로 간주
      this.inspector.incrementResourceCount(1);
      
      await this.checkRootAccessKeys();
      await this.checkRootAccountUsage();
      this.inspector.logger.debug('Completed root access key checks');
    } catch (error) {
      this.inspector.logger.error('Error in root access key checks:', error);
      // 오류 발생 시 Finding을 생성하지 않고 로그만 기록
      this.inspector.recordError(error, { operation: 'runAllChecks' });
    }
  }

  /**
   * 루트 액세스 키 존재 여부 검사
   */
  async checkRootAccessKeys() {
    try {
      const iamClient = this.inspector.iamClient;
      
      this.inspector.logger.debug('Checking root access keys via account summary');
      
      // 계정 요약 정보 조회
      const command = new GetAccountSummaryCommand({});
      const summaryResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetAccountSummary'
      );
      const summaryMap = summaryResponse.SummaryMap || {};
      
      // 루트 액세스 키 개수 확인
      const rootAccessKeys = summaryMap.AccountAccessKeysPresent || 0;
      
      this.inspector.logger.debug(`Root access keys found: ${rootAccessKeys}`);
      
      if (rootAccessKeys > 0) {
        this.inspector.logger.debug('Creating CRITICAL finding for root access keys');
        const finding = new InspectionFinding({
          resourceId: 'root-account',
          resourceType: 'IAMUser',
          riskLevel: 'CRITICAL',
          issue: `루트 계정에 ${rootAccessKeys}개의 액세스 키가 존재합니다`,
          recommendation: '루트 계정의 액세스 키를 즉시 삭제하고 IAM 사용자를 통해 관리 작업을 수행하세요.'
        });
        this.inspector.addFinding(finding);
      } else {
        this.inspector.logger.debug('No root access keys found (PASS)');
      }
      
    } catch (error) {
      this.inspector.logger.debug('Account summary failed, trying alternative method');
      // 계정 요약 정보를 가져올 수 없는 경우 대체 방법 시도
      await this.checkRootAccessKeysAlternative();
    }
  }

  /**
   * 대체 방법으로 루트 액세스 키 검사
   */
  async checkRootAccessKeysAlternative() {
    try {
      const iamClient = this.inspector.iamClient;
      
      // 자격 증명 보고서를 통한 검사 시도
      const command = new GetCredentialReportCommand({});
      const reportResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetCredentialReport'
      );
      const reportContent = reportResponse.Content.toString();
      const lines = reportContent.split('\n');
      
      // CSV 헤더 파싱
      const headers = lines[0].split(',');
      const userIndex = headers.indexOf('user');
      const accessKey1ActiveIndex = headers.indexOf('access_key_1_active');
      const accessKey2ActiveIndex = headers.indexOf('access_key_2_active');
      
      // 루트 사용자 행 찾기
      const rootLine = lines.find(line => {
        const columns = line.split(',');
        return columns[userIndex] === '<root_account>';
      });
      
      if (rootLine) {
        const columns = rootLine.split(',');
        const hasAccessKey1 = columns[accessKey1ActiveIndex] === 'true';
        const hasAccessKey2 = columns[accessKey2ActiveIndex] === 'true';
        
        if (hasAccessKey1 || hasAccessKey2) {
          const keyCount = (hasAccessKey1 ? 1 : 0) + (hasAccessKey2 ? 1 : 0);
          const finding = new InspectionFinding({
            resourceId: 'root-account',
            resourceType: 'IAMUser',
            riskLevel: 'CRITICAL',
            issue: `루트 계정에 ${keyCount}개의 활성 액세스 키가 있습니다`,
            recommendation: '루트 계정의 액세스 키를 즉시 삭제하고 IAM 사용자를 통해 관리 작업을 수행하세요.'
          });
          this.inspector.addFinding(finding);
        } else {
          // 루트 계정에 활성 액세스 키가 없는 경우 Finding을 생성하지 않음 (PASS)
        }
      }
      
    } catch (error) {
      // 자격 증명 보고서도 사용할 수 없는 경우 로그만 기록
      this.inspector.recordError(new Error('Cannot determine root access key status'), { 
        operation: 'checkRootAccessKeysAlternative' 
      });
    }
  }

  /**
   * 루트 계정 사용 패턴 검사
   */
  async checkRootAccountUsage() {
    try {
      const iamClient = this.inspector.iamClient;
      
      // 자격 증명 보고서를 통한 루트 계정 사용 이력 확인
      const command = new GetCredentialReportCommand({});
      const reportResponse = await this.inspector.retryableApiCall(
        () => iamClient.send(command),
        'GetCredentialReport'
      );
      const reportContent = reportResponse.Content.toString();
      const lines = reportContent.split('\n');
      
      // CSV 헤더 파싱
      const headers = lines[0].split(',');
      const userIndex = headers.indexOf('user');
      const passwordLastUsedIndex = headers.indexOf('password_last_used');
      const accessKey1LastUsedDateIndex = headers.indexOf('access_key_1_last_used_date');
      const accessKey2LastUsedDateIndex = headers.indexOf('access_key_2_last_used_date');
      
      // 루트 사용자 행 찾기
      const rootLine = lines.find(line => {
        const columns = line.split(',');
        return columns[userIndex] === '<root_account>';
      });
      
      if (rootLine) {
        const columns = rootLine.split(',');
        const passwordLastUsed = columns[passwordLastUsedIndex];
        const accessKey1LastUsed = columns[accessKey1LastUsedDateIndex];
        const accessKey2LastUsed = columns[accessKey2LastUsedDateIndex];
        
        // 최근 사용 여부 확인
        const now = new Date();
        let recentUsage = false;
        let lastUsageType = '';
        
        if (passwordLastUsed && passwordLastUsed !== 'N/A' && passwordLastUsed !== 'no_information') {
          const lastUsedDate = new Date(passwordLastUsed);
          const daysSinceLastUse = Math.floor((now - lastUsedDate) / (1000 * 60 * 60 * 24));
          if (daysSinceLastUse < 90) {
            recentUsage = true;
            lastUsageType = '콘솔 로그인';
          }
        }
        
        if (accessKey1LastUsed && accessKey1LastUsed !== 'N/A') {
          const lastUsedDate = new Date(accessKey1LastUsed);
          const daysSinceLastUse = Math.floor((now - lastUsedDate) / (1000 * 60 * 60 * 24));
          if (daysSinceLastUse < 90) {
            recentUsage = true;
            lastUsageType = '액세스 키';
          }
        }
        
        if (accessKey2LastUsed && accessKey2LastUsed !== 'N/A') {
          const lastUsedDate = new Date(accessKey2LastUsed);
          const daysSinceLastUse = Math.floor((now - lastUsedDate) / (1000 * 60 * 60 * 24));
          if (daysSinceLastUse < 90) {
            recentUsage = true;
            lastUsageType = '액세스 키';
          }
        }
        
        if (recentUsage) {
          const finding = new InspectionFinding({
            resourceId: 'root-account-usage',
            resourceType: 'IAMUser',
            riskLevel: 'HIGH',
            issue: `루트 계정이 최근 90일 내에 사용되었습니다 (${lastUsageType})`,
            recommendation: '루트 계정 사용을 최소화하고 일상적인 관리 작업은 IAM 사용자나 역할을 통해 수행하세요.'
          });
          this.inspector.addFinding(finding);
        } else {
          // 루트 계정이 최근 사용되지 않은 경우 Finding을 생성하지 않음 (PASS)
        }
      }
      
    } catch (error) {
      // 자격 증명 보고서를 사용할 수 없는 경우 로그만 기록
      this.inspector.recordError(new Error('Cannot determine root account usage history'), { 
        operation: 'checkRootAccountUsage' 
      });
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

module.exports = RootAccessKeyChecker;