/**
 * 사용자 모델
 * DynamoDB 사용자 테이블 스키마 및 헬퍼 함수
 */

const UserSchema = {
  // Primary Key
  userId: 'string', // UUID
  
  // 기본 정보
  username: 'string', // 이메일 형식
  companyName: 'string',
  roleArn: 'string', // AWS IAM Role ARN
  
  // 상태 관리
  status: 'string', // pending, approved, rejected
  isAdmin: 'boolean', // 관리자 권한
  
  // ARN 검증 정보
  arnValidation: {
    isValid: 'boolean',
    lastChecked: 'string', // ISO timestamp
    error: 'string'
  },
  
  // 타임스탬프
  createdAt: 'string', // ISO timestamp
  updatedAt: 'string'  // ISO timestamp
};

module.exports = {
  tableName: process.env.AWS_DYNAMODB_TABLE_NAME || 'aws_v2',
  schema: UserSchema,
  
  // 사용자 상태 상수
  STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved', 
    REJECTED: 'rejected'
  },
  
  // 에러 코드 상수
  ERROR_CODES: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    DUPLICATE_USER: 'DUPLICATE_USER',
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    INVALID_STATUS: 'INVALID_STATUS',
    MISSING_PARAMETER: 'MISSING_PARAMETER',
    DATABASE_ERROR: 'DATABASE_ERROR',
    INVALID_CURRENT_PASSWORD: 'INVALID_CURRENT_PASSWORD',
    PASSWORD_CHANGE_FAILED: 'PASSWORD_CHANGE_FAILED',
    USER_EXISTS: 'USER_EXISTS',
    COGNITO_ERROR: 'COGNITO_ERROR',
    AUTH_FAILED: 'AUTH_FAILED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    TOKEN_ERROR: 'TOKEN_ERROR',
    VERIFICATION_ERROR: 'VERIFICATION_ERROR'
  },
  
  // 헬퍼 함수들
  helpers: {
    /**
     * 새 사용자 데이터 생성
     */
    createUserData(userData) {
      const timestamp = new Date().toISOString();
      
      return {
        username: userData.username,
        companyName: userData.companyName,
        roleArn: userData.roleArn,
        status: module.exports.STATUS.PENDING,
        isAdmin: userData.isAdmin || false,
        arnValidation: {
          isValid: null,
          lastChecked: null,
          error: null
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };
    },
    
    /**
     * 사용자 데이터 검증
     */
    validateUserData(userData) {
      const errors = [];
      
      if (!userData.username || !userData.username.includes('@')) {
        errors.push('유효한 이메일 주소가 필요합니다');
      }
      
      if (!userData.companyName || userData.companyName.length < 2) {
        errors.push('회사명은 2자 이상이어야 합니다');
      }
      
      if (!userData.roleArn || !userData.roleArn.startsWith('arn:aws:iam::')) {
        errors.push('유효한 AWS IAM Role ARN이 필요합니다');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    },
    
    /**
     * ARN 검증 결과 생성
     */
    createArnValidation(isValid, error = null) {
      return {
        isValid,
        lastChecked: new Date().toISOString(),
        error
      };
    },
    
    /**
     * 상태 검증
     */
    validateStatus(status) {
      return Object.values(module.exports.STATUS).includes(status);
    },
    
    /**
     * 업데이트 데이터 생성
     */
    createUpdateData(updateFields) {
      return {
        ...updateFields,
        updatedAt: new Date().toISOString()
      };
    },
    
    /**
     * 타임스탬프 업데이트 데이터 생성
     */
    createTimestampUpdate() {
      return {
        updatedAt: new Date().toISOString()
      };
    },
    
    /**
     * 에러 객체 생성
     */
    createError(message, code, originalError = null) {
      const error = new Error(message);
      error.code = code;
      if (originalError) {
        error.originalError = originalError;
      }
      return error;
    },
    
    /**
     * 사용자 ID 검증
     */
    validateUserId(userId) {
      if (!userId || typeof userId !== 'string') {
        return {
          isValid: false,
          error: '유효한 사용자 ID가 필요합니다'
        };
      }
      return { isValid: true };
    },
    
    /**
     * 사용자 데이터 필터링 (민감한 정보 제거)
     */
    filterUserData(user, includePrivate = false) {
      if (!user) return null;
      
      const filtered = {
        userId: user.userId,
        username: user.username,
        companyName: user.companyName,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };
      
      if (includePrivate) {
        filtered.roleArn = user.roleArn;
        filtered.arnValidation = user.arnValidation;
        filtered.isAdmin = user.isAdmin;
      }
      
      return filtered;
    },
    
    /**
     * 비밀번호 변경 데이터 검증
     */
    validatePasswordChange(passwordData) {
      const { currentPassword, newPassword, confirmPassword } = passwordData;
      const errors = [];
      
      if (!currentPassword || !newPassword || !confirmPassword) {
        errors.push('Current password, new password, and confirm password are required');
      }
      
      if (newPassword && newPassword.length < 8) {
        errors.push('New password must be at least 8 characters long');
      }
      
      if (newPassword !== confirmPassword) {
        errors.push('New password and confirm password do not match');
      }
      
      if (currentPassword === newPassword) {
        errors.push('New password must be different from current password');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    },
    
    /**
     * 회원가입 데이터 검증
     */
    validateRegistrationData(registrationData) {
      const { username, password, roleArn, companyName } = registrationData;
      const errors = [];
      
      if (!username || !username.includes('@')) {
        errors.push('Valid email address is required');
      }
      
      if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
      }
      
      if (!companyName || companyName.length < 2) {
        errors.push('Company name must be at least 2 characters long');
      }
      
      if (!roleArn || !roleArn.startsWith('arn:aws:iam::')) {
        errors.push('Valid AWS IAM Role ARN is required');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    },
    
    /**
     * 로그인 데이터 검증
     */
    validateLoginData(loginData) {
      const { username, password } = loginData;
      const errors = [];
      
      if (!username || !username.includes('@')) {
        errors.push('Valid email address is required');
      }
      
      if (!password) {
        errors.push('Password is required');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  }
};