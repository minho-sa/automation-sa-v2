/**
 * WebSocket Service for Real-time Progress Updates
 * WebSocket을 통한 실시간 상태 업데이트
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map<inspectionId, Set<WebSocket>>
    this.userConnections = new Map(); // Map<userId, Set<WebSocket>>
    this.logger = this.createLogger();
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/ws/inspections',
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleError.bind(this));



    // Cleanup disconnected clients periodically (increased interval for long-running inspections)
    setInterval(() => {
      this.cleanupDisconnectedClients();
    }, 60000); // Every 60 seconds (increased from 30)
  }

  /**
   * Verify client connection (authentication)
   * @param {Object} info - Connection info
   * @returns {boolean} Whether to accept the connection
   */
  verifyClient(info) {
    try {
      const url = new URL(info.req.url, 'ws://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        this.logger.warn('WebSocket connection rejected: No token provided');
        return false;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.secret);
      if (!decoded.userId) {
        this.logger.warn('WebSocket connection rejected: Invalid token');
        return false;
      }

      // Store user info for later use
      info.req.user = decoded;
      return true;

    } catch (error) {
      this.logger.warn('WebSocket connection rejected: Token verification failed', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} req - HTTP request
   */
  handleConnection(ws, req) {
    const userId = req.user.userId;
    const connectionId = this.generateConnectionId();

    // Store connection metadata
    ws.userId = userId;
    ws.connectionId = connectionId;
    ws.subscribedInspections = new Set();
    ws.isAlive = true;
    ws.connectionTime = Date.now();
    ws.lastPongTime = Date.now();

    // Add to user connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId).add(ws);



    // Set up ping/pong for connection health
    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastPongTime = Date.now();
    });

    // Handle incoming messages
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
      this.handleDisconnection(ws, code, reason);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      this.logger.error('WebSocket client error', {
        userId,
        connectionId,
        error: error.message
      });
    });

    // Send welcome message
    this.sendMessage(ws, {
      type: 'connection_established',
      data: {
        connectionId,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   * @param {WebSocket} ws - WebSocket connection
   * @param {Buffer} data - Message data
   */
  handleMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;

      switch (type) {
        case 'subscribe_inspection':
          this.handleSubscribeInspection(ws, payload);
          break;

        case 'unsubscribe_inspection':
          this.handleUnsubscribeInspection(ws, payload);
          break;

        case 'ping':
          this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
          break;

        default:
          this.logger.warn('Unknown WebSocket message type', {
            type,
            userId: ws.userId,
            connectionId: ws.connectionId
          });
      }

    } catch (error) {
      this.logger.error('Error handling WebSocket message', {
        userId: ws.userId,
        connectionId: ws.connectionId,
        error: error.message
      });

      this.sendMessage(ws, {
        type: 'error',
        data: {
          code: 'MESSAGE_PARSE_ERROR',
          message: 'Failed to parse message'
        }
      });
    }
  }

  /**
   * Handle inspection subscription
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} payload - Subscription payload
   */
  handleSubscribeInspection(ws, payload) {
    const { inspectionId } = payload;



    if (!inspectionId) {
      this.sendMessage(ws, {
        type: 'error',
        data: {
          code: 'MISSING_INSPECTION_ID',
          message: 'Inspection ID is required for subscription'
        }
      });
      return;
    }

    // 이미 구독된 검사인지 확인
    if (ws.subscribedInspections && ws.subscribedInspections.has(inspectionId)) {
      
      // 이미 구독된 경우에도 확인 메시지 전송
      this.sendMessage(ws, {
        type: 'subscription_confirmed',
        data: {
          inspectionId,
          timestamp: Date.now(),
          alreadySubscribed: true
        }
      });
      return;
    }

    // Add to inspection subscribers
    if (!this.clients.has(inspectionId)) {
      this.clients.set(inspectionId, new Set());
    }
    
    this.clients.get(inspectionId).add(ws);
    ws.subscribedInspections.add(inspectionId);

    this.sendMessage(ws, {
      type: 'subscription_confirmed',
      data: {
        inspectionId,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle inspection unsubscription
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} payload - Unsubscription payload
   */
  handleUnsubscribeInspection(ws, payload) {
    const { inspectionId } = payload;

    if (!inspectionId) {
      return;
    }

    // Remove from inspection subscribers
    if (this.clients.has(inspectionId)) {
      this.clients.get(inspectionId).delete(ws);
      if (this.clients.get(inspectionId).size === 0) {
        this.clients.delete(inspectionId);
      }
    }
    ws.subscribedInspections.delete(inspectionId);

    this.sendMessage(ws, {
      type: 'unsubscription_confirmed',
      data: {
        inspectionId,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle client disconnection
   * @param {WebSocket} ws - WebSocket connection
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  handleDisconnection(ws, code, reason) {
    const userId = ws.userId;
    const connectionId = ws.connectionId;

    // Remove from user connections
    if (this.userConnections.has(userId)) {
      this.userConnections.get(userId).delete(ws);
      if (this.userConnections.get(userId).size === 0) {
        this.userConnections.delete(userId);
      }
    }

    // Remove from inspection subscriptions
    ws.subscribedInspections.forEach(inspectionId => {
      if (this.clients.has(inspectionId)) {
        this.clients.get(inspectionId).delete(ws);
        if (this.clients.get(inspectionId).size === 0) {
          this.clients.delete(inspectionId);
        }
      }
    });


  }

  /**
   * Handle WebSocket server errors
   * @param {Error} error - Error object
   */
  handleError(error) {
    this.logger.error('WebSocket server error', {
      error: error.message,
      stack: error.stack
    });
  }

  /**
   * Broadcast inspection progress update
   * Requirements: 6.1, 6.2, 6.3 - 실시간 진행률 업데이트
   * @param {string} inspectionId - Inspection ID
   * @param {Object} progressData - Progress data
   */
  broadcastProgressUpdate(inspectionId, progressData) {
    const subscribers = this.clients.get(inspectionId);
    
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = {
      type: 'progress_update',
      data: {
        inspectionId,
        ...progressData,
        timestamp: Date.now()
      }
    };

    subscribers.forEach(ws => {
      this.sendMessage(ws, message);
    });
  }

  /**
   * Broadcast inspection status change
   * Requirements: 6.1, 6.3 - 실시간 상태 업데이트
   * @param {string} inspectionId - Inspection ID
   * @param {Object} statusData - Status data
   */
  broadcastStatusChange(inspectionId, statusData) {
    const subscribers = this.clients.get(inspectionId);
    
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = {
      type: 'status_change',
      data: {
        inspectionId,
        ...statusData,
        timestamp: Date.now()
      }
    };

    subscribers.forEach(ws => {
      this.sendMessage(ws, message);
    });
  }

  /**
   * Broadcast inspection completion
   * Requirements: 6.1, 6.4 - 검사 완료 알림
   * @param {string} inspectionId - Inspection ID
   * @param {Object} completionData - Completion data
   */
  broadcastInspectionComplete(inspectionId, completionData) {
    const subscribers = this.clients.get(inspectionId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const message = {
      type: 'inspection_complete',
      data: {
        inspectionId,
        ...completionData,
        timestamp: Date.now(),
        forceRefresh: true, // 프론트엔드에서 강제 새로고침 트리거
        refreshCommand: 'RELOAD_ALL_DATA', // 명시적 새로고침 명령
        cacheBreaker: Date.now() // 캐시 무효화용 타임스탬프
      }
    };

    subscribers.forEach(ws => {
      this.sendMessage(ws, message);
    });
  }

  /**
   * Send message to WebSocket client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Message to send
   * @returns {boolean} Success status
   */
  sendMessage(ws, message) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('Error sending WebSocket message', {
        userId: ws.userId,
        connectionId: ws.connectionId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Clean up disconnected clients
   */
  cleanupDisconnectedClients() {
    let cleanedCount = 0;

    // Check all clients and remove disconnected ones
    this.wss.clients.forEach(ws => {
      if (!ws.isAlive) {
        // Give more time for long-running inspections
        const timeSinceLastPong = Date.now() - (ws.lastPongTime || ws.connectionTime || Date.now());
        if (timeSinceLastPong > 180000) { // 3 minutes instead of immediate termination
          ws.terminate();
          cleanedCount++;
          return;
        }
      }

      ws.isAlive = false;
      ws.lastPingTime = Date.now();
      ws.ping();
    });


  }



  /**
   * Generate unique connection ID
   * @returns {string} Connection ID
   */
  generateConnectionId() {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }



  /**
   * Move subscribers from individual inspection ID to batch ID
   * @param {string} fromInspectionId - Source inspection ID
   * @param {string} toBatchId - Target batch ID
   * @returns {boolean} Whether the move was successful
   */
  moveSubscribersToBatch(fromInspectionId, toBatchId) {
    const fromSubscribers = this.clients.get(fromInspectionId);
    
    if (!fromSubscribers || fromSubscribers.size === 0) {
      return false;
    }

    // 배치 ID 구독자 집합 생성 또는 가져오기
    if (!this.clients.has(toBatchId)) {
      this.clients.set(toBatchId, new Set());
    }
    const batchSubscribers = this.clients.get(toBatchId);

    let movedCount = 0;
    // 구독자들을 배치 ID로 이동 (중복 방지)
    fromSubscribers.forEach(ws => {
      if (!batchSubscribers.has(ws)) {
        batchSubscribers.add(ws);
        movedCount++;
      }
      // 웹소켓 객체의 구독 정보도 업데이트
      if (ws.subscribedInspections) {
        ws.subscribedInspections.delete(fromInspectionId);
        ws.subscribedInspections.add(toBatchId);
      }
    });

    // 기존 개별 검사 ID 구독자 제거
    this.clients.delete(fromInspectionId);



    return movedCount > 0;
  }



  /**
   * Clean up batch subscribers
   * @param {string} batchId - Batch ID
   * @param {Array} inspectionIds - Array of inspection IDs in the batch
   */
  cleanupBatchSubscribers(batchId, inspectionIds) {
    // 배치 ID와 모든 개별 검사 ID의 구독자 정리
    const allIds = [batchId, ...inspectionIds];
    
    allIds.forEach(id => {
      const subscribers = this.clients.get(id);
      if (subscribers && subscribers.size > 0) {
        this.clients.delete(id);
      }
    });
  }

  /**
   * Create logger instance
   * @returns {Object} Logger object
   */
  createLogger() {
    return {
      debug: (message, meta = {}) => {
        // DEBUG 로그 완전 비활성화
      },
      info: (message, meta = {}) => {
        // INFO 로그 완전 비활성화 (에러와 경고만 유지)
      },
      warn: (message, meta = {}) => {
        console.warn(`[WARN] [WebSocketService] ${message}`, meta);
      },
      error: (message, meta = {}) => {
        console.error(`[ERROR] [WebSocketService] ${message}`, meta);
      }
    };
  }


}

// Create singleton instance
const webSocketService = new WebSocketService();

module.exports = webSocketService;