const cognitoService = require('../services/cognitoService');
const dynamoService = require('../services/dynamoService');
const { generateToken } = require('../utils/jwt');
const { User } = require('../models');

/**
 * 회원가입 처리
 * POST /api/auth/register
 */
const register = async (req, res) => {
    try {
        const { username, password, roleArn, companyName } = req.body;

        // 1. 모델을 사용한 입력 데이터 검증
        const validation = User.helpers.validateRegistrationData({ username, password, roleArn, companyName });
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Registration data validation failed',
                    details: validation.errors.join(', ')
                }
            });
        }

        // 2. DynamoDB에서 사용자명 중복 확인
        const existingUser = await dynamoService.getUserByUsername(username);
        if (existingUser.success) {
            return res.status(409).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.USER_EXISTS,
                    message: 'Username already exists',
                    details: 'A user with this username already exists in the system'
                }
            });
        }

        // 3. AWS Cognito에 사용자 생성
        const cognitoResult = await cognitoService.createUser(username, password);

        if (!cognitoResult.success) {
            return res.status(500).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.COGNITO_ERROR,
                    message: 'Failed to create user in Cognito',
                    details: 'User creation in AWS Cognito failed'
                }
            });
        }

        // 4. DynamoDB에 사용자 메타데이터 저장
        const dynamoResult = await dynamoService.createUser({
            username,
            companyName,
            roleArn,
            isAdmin: false // 회원가입 시 항상 일반 사용자로 설정
        });

        if (!dynamoResult.success) {
            // Cognito에서 사용자 생성은 성공했지만 DynamoDB 저장 실패 시 롤백
            try {
                await cognitoService.deleteUser(username);
            } catch (rollbackError) {
                // Rollback failed - continue with original error response
            }

            return res.status(500).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.DATABASE_ERROR,
                    message: 'Failed to save user metadata',
                    details: 'User metadata could not be saved to database'
                }
            });
        }

        // 5. 성공 응답
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            userId: dynamoResult.userId,
            data: {
                username: dynamoResult.user.username,
                companyName: dynamoResult.user.companyName,
                status: dynamoResult.user.status,
                createdAt: dynamoResult.user.createdAt
            }
        });

    } catch (error) {
        if (error.code) {
            const statusCode = error.code === User.ERROR_CODES.USER_EXISTS ? 409 : 500;
            return res.status(statusCode).json({
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    details: error.message
                }
            });
        }

        res.status(500).json({
            success: false,
            error: {
                code: User.ERROR_CODES.INTERNAL_ERROR,
                message: 'Internal server error',
                details: 'An unexpected error occurred during registration'
            }
        });
    }
};

/**
 * 로그인 처리
 * POST /api/auth/login
 */
const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // 1. 모델을 사용한 입력 데이터 검증
        const validation = User.helpers.validateLoginData({ username, password });
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Login data validation failed',
                    details: validation.errors.join(', ')
                }
            });
        }

        // 2. AWS Cognito를 통한 사용자 인증
        const cognitoResult = await cognitoService.authenticateUser(username, password);

        if (!cognitoResult.success) {
            return res.status(401).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.AUTH_FAILED,
                    message: 'Authentication failed',
                    details: 'Invalid username or password'
                }
            });
        }

        // 3. DynamoDB에서 사용자 상태 및 메타데이터 조회
        const userResult = await dynamoService.getUserByUsername(username);

        if (!userResult.success) {
            return res.status(404).json({
                success: false,
                error: {
                    code: User.ERROR_CODES.USER_NOT_FOUND,
                    message: 'User not found',
                    details: 'User metadata not found in database'
                }
            });
        }

        const user = userResult.user;

        // 4. JWT 토큰 생성
        const tokenPayload = {
            userId: user.userId,
            username: user.username,
            status: user.status,
            isAdmin: user.isAdmin || false // DynamoDB의 isAdmin 필드 사용
        };

        const jwtToken = generateToken(tokenPayload);

        // 5. 성공 응답 (사용자 상태 포함)
        res.status(200).json({
            success: true,
            message: 'Login successful',
            token: jwtToken,
            userStatus: user.status,
            data: {
                userId: user.userId,
                username: user.username,
                companyName: user.companyName,
                status: user.status,
                roleArn: user.roleArn,
                arnValidation: user.arnValidation,
                createdAt: user.createdAt
            }
        });

    } catch (error) {
        if (error.code) {
            const statusCode = {
                [User.ERROR_CODES.AUTH_FAILED]: 401,
                [User.ERROR_CODES.USER_NOT_FOUND]: 404,
                [User.ERROR_CODES.VALIDATION_ERROR]: 400
            }[error.code] || 500;
            
            return res.status(statusCode).json({
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    details: error.message
                }
            });
        }

        res.status(500).json({
            success: false,
            error: {
                code: User.ERROR_CODES.INTERNAL_ERROR,
                message: 'Internal server error',
                details: 'An unexpected error occurred during login'
            }
        });
    }
};

/**
 * 토큰 검증 처리
 * GET /api/auth/verify
 */
const verify = async (req, res) => {
    try {
        // 미들웨어에서 이미 토큰을 검증하고 사용자 정보를 req.user에 저장했음
        const { userId, username, status } = req.user;

        // DynamoDB에서 최신 사용자 정보 조회
        const userResult = await dynamoService.getUserByUsername(username);

        if (!userResult.success) {
            return res.status(404).json({
                success: false,
                valid: false,
                error: {
                    code: User.ERROR_CODES.USER_NOT_FOUND,
                    message: 'User not found',
                    details: 'User metadata not found in database'
                }
            });
        }

        const user = userResult.user;

        // 토큰 검증 성공 응답
        res.status(200).json({
            success: true,
            valid: true,
            message: 'Token is valid',
            userInfo: {
                userId: user.userId,
                username: user.username,
                companyName: user.companyName,
                status: user.status,
                role: user.isAdmin ? 'admin' : 'user',
                roleArn: user.roleArn,
                arnValidation: user.arnValidation,
                createdAt: user.createdAt
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            valid: false,
            error: {
                code: User.ERROR_CODES.VERIFICATION_ERROR,
                message: 'Token verification failed',
                details: 'An error occurred while verifying the token'
            }
        });
    }
};

module.exports = {
    register,
    login,
    verify
};