import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './utils/logger.js';
import { zkToolExecutor } from './services/zkToolExecutor1.js';

declare global {
    var wsServer: WebSocketServer;
}

function generateJobId() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

interface Job {
    id: string;
    toolName: string;
    parameters: any;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startTime: Date;
    endTime?: Date;
    result?: any;
    error?: string;
    progress?: number;
}

class AsyncJobManager {
    private jobs = new Map<string, Job>();
    private wss: WebSocketServer;
    private isAsyncEnabled: boolean;

    constructor(wss: WebSocketServer) {
        this.wss = wss;
        this.isAsyncEnabled = process.env.ENABLE_ASYNC_JOBS !== 'false';
        logger.info(`Async job management ${this.isAsyncEnabled ? 'enabled' : 'disabled'}`);
    }

    async startJob(jobId: string, toolName: string, parameters: any): Promise<Job> {
        const job: Job = {
            id: jobId,
            toolName,
            parameters,
            status: 'pending',
            startTime: new Date()
        };

        this.jobs.set(jobId, job);
        this.broadcastJobUpdate(job);

        this.processJob(job);

        return job;
    }

    private async processJob(job: Job) {
        try {
            job.status = 'running';
            job.progress = 0;
            this.broadcastJobUpdate(job);

            logger.info(`Starting async job ${job.id}: ${job.toolName}`);

            job.progress = 10;
            this.broadcastJobUpdate(job);

            const startTime = Date.now();
            const result = await zkToolExecutor.executeTool(job.toolName, job.parameters);
            const executionTime = Date.now() - startTime;

            job.status = 'completed';
            job.result = {
                ...result,
                executionTimeMs: executionTime,
                jobId: job.id,
                completedAt: new Date().toISOString(),
                mode: 'async-integrated-server'
            };
            job.endTime = new Date();
            job.progress = 100;

            logger.info(`Async job ${job.id} completed successfully in ${executionTime}ms`);

        } catch (error) {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : 'Unknown error';
            job.endTime = new Date();

            logger.error(`Async job ${job.id} failed:`, error);
        }

        this.broadcastJobUpdate(job);
    }

    private broadcastJobUpdate(job: Job) {
        const message = JSON.stringify({
            type: 'job_update',
            jobId: job.id,
            status: job.status,
            progress: job.progress,
            result: job.result,
            error: job.error,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server'
        });

        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(message);
            }
        });
    }

    getJob(jobId: string): Job | undefined {
        return this.jobs.get(jobId);
    }

    getAllJobs(): Job[] {
        return Array.from(this.jobs.values());
    }

    getActiveJobs(): Job[] {
        return Array.from(this.jobs.values()).filter(job =>
            job.status === 'pending' || job.status === 'running'
        );
    }

    clearCompletedJobs() {
        for (const [jobId, job] of this.jobs.entries()) {
            if (job.status === 'completed' || job.status === 'failed') {
                this.jobs.delete(jobId);
            }
        }
    }
}

const app = express();
const server = createServer(app);

const wss = new WebSocketServer({ server });
global.wsServer = wss;

const jobManager = new AsyncJobManager(wss);

const ZK_PRET_HTTP_SERVER_PORT = parseInt(process.env.ZK_PRET_HTTP_SERVER_PORT || '3001', 10);
const ZK_PRET_HTTP_SERVER_HOST = process.env.ZK_PRET_HTTP_SERVER_HOST || '0.0.0.0';

app.use(helmet());

const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));

app.use(express.json({ limit: process.env.MAX_REQUEST_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_REQUEST_SIZE || '10mb' }));

if (process.env.ZK_PRET_ENABLE_API_AUTH === 'true') {
    const API_KEY = process.env.ZK_PRET_API_KEY;

    const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const providedKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

        if (!providedKey || providedKey !== API_KEY) {
            logger.warn('Unauthorized API access attempt', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                url: req.url,
                providedKey: providedKey ? '[REDACTED]' : 'none'
            });

            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Valid API key required',
                timestamp: new Date().toISOString(),
                server: 'zk-pret-integrated-server'
            });
        }

        next();
    };

    app.use('/api/v1/tools', requireApiKey);
    logger.info('API key authentication enabled for tool endpoints');
} else {
    logger.info('API key authentication disabled');
}

app.use((req, res, next) => {
    logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

wss.on('connection', (ws) => {
    logger.info('New WebSocket connection established');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            logger.info('WebSocket message received:', data);

            if (data.type === 'subscribe_state_monitoring') {
                ws.send(JSON.stringify({
                    type: 'state_monitoring_subscribed',
                    message: 'Subscribed to progressive state monitoring',
                    timestamp: new Date().toISOString(),
                    server: 'zk-pret-integrated-server'
                }));
            }
        } catch (error) {
            logger.error('Invalid WebSocket message:', error);
        }
    });

    ws.on('close', () => {
        logger.info('WebSocket connection closed');
    });

    ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        server: 'zk-pret-integrated-server',
        timestamp: new Date().toISOString(),
        features: {
            progressiveStateMonitoring: true,
            asyncJobs: process.env.ENABLE_ASYNC_JOBS !== 'false',
            realTimeUpdates: true
        }
    }));
});

app.get('/api/v1/health', async (req, res) => {
    try {
        const executorHealth = await zkToolExecutor.healthCheck();

        return res.json({
            status: executorHealth.connected ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            version: '1.0.0',
            mode: 'integrated',
            services: {
                zkExecutor: executorHealth.connected,
                asyncJobs: process.env.ENABLE_ASYNC_JOBS !== 'false',
                websockets: wss.clients.size > 0,
                progressiveStateMonitoring: true,
                stdioPath: executorHealth.status?.path
            },
            activeJobs: jobManager.getActiveJobs().length,
            websocketConnections: wss.clients.size,
            executorStatus: executorHealth.status
        });
    } catch (error) {
        logger.error('Health check failed', { error: error instanceof Error ? error.message : String(error) });
        return res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: 'Health check failed'
        });
    }
});

app.get('/api/v1/tools', async (req, res) => {
    try {
        const tools = zkToolExecutor.getAvailableTools();

        return res.json({
            success: true,
            tools,
            count: tools.length,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'integrated',
            features: {
                syncExecution: true,
                asyncExecution: process.env.ENABLE_ASYNC_JOBS !== 'false',
                websockets: true,
                directBackendAccess: true,
                progressiveStateMonitoring: true
            }
        });
    } catch (error) {
        logger.error('Failed to list tools', { error: error instanceof Error ? error.message : String(error) });
        return res.status(500).json({
            success: false,
            error: 'Failed to list tools',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/v1/tools/execute', async (req, res) => {
    const startTime = Date.now();

    try {
        const { toolName, parameters } = req.body;

        console.log('======================================================', toolName, parameters);
        if (!toolName) {
            return res.status(400).json({
                success: false,
                error: 'toolName is required',
                timestamp: new Date().toISOString()
            });
        }

        logger.info('SYNC execution started', {
            toolName,
            parameters: JSON.stringify(parameters),
            mode: 'sync-integrated',
            progressiveStateMonitoring: true
        });

        const message = JSON.stringify({
            type: 'sync_execution_started',
            toolName,
            parameters,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server'
        });

        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(message);
            }
        });

        const result = await zkToolExecutor.executeTool(toolName, parameters || {});
        const totalTime = Date.now() - startTime;

        logger.info('SYNC execution completed', {
            toolName,
            success: result.success,
            executionTime: result.executionTime,
            totalTime: `${totalTime}ms`,
            mode: 'sync-integrated',
            hasStateData: !!(result.result?.contractStateBefore || result.result?.contractStateAfter)
        });

        const enhancedResponse = {
            success: result.success,
            toolName,
            parameters,
            result: result.result,
            executionTime: result.executionTime,
            totalTime: `${totalTime}ms`,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'sync',

            progressiveStateMonitoring: {
                enabled: true,
                contractStateBefore: result.result?.contractStateBefore || null,
                contractStateAfter: result.result?.contractStateAfter || null,
                stateChanges: result.result?.stateChanges || null,
                websocketUpdatesProvided: wss.clients.size > 0
            }
        };

        const completionMessage = JSON.stringify({
            type: 'sync_execution_completed',
            toolName,
            success: result.success,
            executionTime: result.executionTime,
            totalTime: `${totalTime}ms`,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server'
        });

        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(completionMessage);
            }
        });

        return res.json(enhancedResponse);

    } catch (error) {
        const totalTime = Date.now() - startTime;

        logger.error('SYNC execution failed', {
            toolName: req.body?.toolName,
            error: error instanceof Error ? error.message : String(error),
            totalTime: `${totalTime}ms`,
            mode: 'sync-integrated'
        });

        const errorMessage = JSON.stringify({
            type: 'sync_execution_failed',
            toolName: req.body?.toolName,
            error: error instanceof Error ? error.message : 'Unknown error',
            totalTime: `${totalTime}ms`,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server'
        });

        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(errorMessage);
            }
        });

        return res.status(500).json({
            success: false,
            toolName: req.body?.toolName,
            error: error instanceof Error ? error.message : 'Unknown error',
            executionTime: '0ms',
            totalTime: `${totalTime}ms`,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'sync',
            progressiveStateMonitoring: {
                enabled: true,
                contractStateBefore: null,
                contractStateAfter: null,
                stateChanges: null,
                websocketUpdatesProvided: false
            }
        });
    }
});

app.post('/api/v1/tools/execute-async', async (req, res) => {
    if (process.env.ENABLE_ASYNC_JOBS === 'false') {
        return res.status(400).json({
            success: false,
            error: 'Async jobs are disabled',
            message: 'Set ENABLE_ASYNC_JOBS=true to use async execution',
            timestamp: new Date().toISOString()
        });
    }

    try {
        const { toolName, parameters, jobId } = req.body;

        if (!toolName) {
            return res.status(400).json({
                success: false,
                error: 'toolName is required',
                timestamp: new Date().toISOString()
            });
        }

        const actualJobId = jobId || generateJobId();

        logger.info('ASYNC execution started', {
            jobId: actualJobId,
            toolName,
            parameters: JSON.stringify(parameters),
            mode: 'async-integrated',
            progressiveStateMonitoring: true
        });

        const job = await jobManager.startJob(actualJobId, toolName, parameters || {});

        return res.json({
            success: true,
            jobId: job.id,
            status: job.status,
            toolName: job.toolName,
            timestamp: job.startTime.toISOString(),
            message: 'Async job started successfully',
            server: 'zk-pret-integrated-server',
            mode: 'async',
            websocketUrl: `ws://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}`,
            progressiveStateMonitoring: true
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: 'Failed to start async job',
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/v1/jobs/:jobId', (req, res) => {
    const job = jobManager.getJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'Job not found',
            jobId: req.params.jobId,
            timestamp: new Date().toISOString()
        });
    }

    return res.json({
        success: true,
        job,
        timestamp: new Date().toISOString(),
        server: 'zk-pret-integrated-server',
        mode: 'async'
    });
});

app.get('/api/v1/jobs', (req, res) => {
    const jobs = jobManager.getAllJobs();
    return res.json({
        success: true,
        jobs,
        total: jobs.length,
        active: jobManager.getActiveJobs().length,
        timestamp: new Date().toISOString(),
        server: 'zk-pret-integrated-server',
        mode: 'async'
    });
});

app.delete('/api/v1/jobs/completed', (req, res) => {
    jobManager.clearCompletedJobs();
    return res.json({
        success: true,
        message: 'Completed jobs cleared',
        timestamp: new Date().toISOString(),
        server: 'zk-pret-integrated-server',
        mode: 'async'
    });
});

app.post('/api/v1/tools/gleif', async (req, res) => {
    try {
        const parameters = req.body;
        const result = await zkToolExecutor.executeTool('get-GLEIF-verification-with-sign', parameters);

        return res.json({
            success: result.success,
            toolName: 'get-GLEIF-verification-with-sign',
            result: result.result,
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'sync',
            progressiveStateMonitoring: {
                contractStateBefore: result.result?.contractStateBefore || null,
                contractStateAfter: result.result?.contractStateAfter || null,
                stateChanges: result.result?.stateChanges || null
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/v1/tools/corporate', async (req, res) => {
    try {
        const parameters = req.body;
        const result = await zkToolExecutor.executeTool('get-Corporate-Registration-verification-with-sign', parameters);

        return res.json({
            success: result.success,
            toolName: 'get-Corporate-Registration-verification-with-sign',
            result: result.result,
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'sync',
            progressiveStateMonitoring: {
                contractStateBefore: result.result?.contractStateBefore || null,
                contractStateAfter: result.result?.contractStateAfter || null,
                stateChanges: result.result?.stateChanges || null
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/v1/tools/exim', async (req, res) => {
    try {
        const parameters = req.body;
        const result = await zkToolExecutor.executeTool('get-EXIM-verification-with-sign', parameters);

        return res.json({
            success: result.success,
            toolName: 'get-EXIM-verification-with-sign',
            result: result.result,
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'sync',
            progressiveStateMonitoring: {
                contractStateBefore: result.result?.contractStateBefore || null,
                contractStateAfter: result.result?.contractStateAfter || null,
                stateChanges: result.result?.stateChanges || null
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/v1/tools/risk', async (req, res) => {
    try {
        const parameters = req.body;
        const toolName = parameters.riskType === 'advanced' ? 'get-RiskLiquidityAdvancedOptimMerkle-verification-with-sign' :
            parameters.riskType === 'basel3' ? 'get-RiskLiquidityBasel3Optim-Merkle-verification-with-sign' :
                parameters.riskType === 'stablecoin' ? 'get-StablecoinProofOfReservesRisk-verification-with-sign' :
                    'get-RiskLiquidityAdvancedOptimMerkle-verification-with-sign';

        const result = await zkToolExecutor.executeTool(toolName, parameters);

        return res.json({
            success: result.success,
            toolName,
            result: result.result,
            executionTime: result.executionTime,
            timestamp: new Date().toISOString(),
            server: 'zk-pret-integrated-server',
            mode: 'sync',
            progressiveStateMonitoring: {
                contractStateBefore: result.result?.contractStateBefore || null,
                contractStateAfter: result.result?.contractStateAfter || null,
                stateChanges: result.result?.stateChanges || null
            }
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/v1/status', async (req, res) => {
    try {
        const executorHealth = await zkToolExecutor.healthCheck();

        return res.json({
            server: 'zk-pret-integrated-server',
            version: '1.0.0',
            mode: 'integrated',
            status: executorHealth.connected ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            port: ZK_PRET_HTTP_SERVER_PORT,
            host: ZK_PRET_HTTP_SERVER_HOST,
            features: {
                syncExecution: true,
                asyncExecution: process.env.ENABLE_ASYNC_JOBS !== 'false',
                realTimeResults: true,
                batchOperations: true,
                websockets: true,
                jobManagement: true,
                directBackendAccess: true,
                progressiveStateMonitoring: true
            },
            executor: {
                connected: executorHealth.connected,
                status: executorHealth.status,
                executionMode: 'direct-only'
            },
            jobs: {
                total: jobManager.getAllJobs().length,
                active: jobManager.getActiveJobs().length
            },
            websockets: {
                connections: wss.clients.size,
                enabled: true,
                progressiveStateUpdates: true
            }
        });
    } catch (error) {
        return res.status(500).json({
            server: 'zk-pret-integrated-server',
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
        });
    }
});

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method
    });

    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
        server: 'zk-pret-integrated-server'
    });
});

app.use((req: express.Request, res: express.Response) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
        server: 'zk-pret-integrated-server'
    });
});

const startServer = async () => {
    try {
        console.log('🚀 Starting ZK-PRET Integrated HTTP Server...');

        console.log('⚡ Initializing ZK Tool Executor...');
        await zkToolExecutor.initialize();
        console.log('✅ ZK Tool Executor initialization completed');

        server.listen(ZK_PRET_HTTP_SERVER_PORT, ZK_PRET_HTTP_SERVER_HOST, () => {
            logger.info(`🚀 ZK-PRET Integrated HTTP Server started successfully`);
            logger.info(`📡 Server URL: http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}`);
            logger.info(`🔄 Mode: Integrated (Backend + Server)`);
            logger.info(`📡 WebSocket URL: ws://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}`);
            logger.info(`⚡ Features: Direct access to ZK-PRET backend tools via HTTP API`);
            logger.info(`🎯 Ready to process ZK-PRET tool requests`);
            logger.info(`📊 Progressive State Monitoring: Enabled`);

            console.log('\n=== ZK-PRET INTEGRATED HTTP SERVER ENDPOINTS ===');
            console.log('🔍 HEALTH & INFO:');
            console.log(`GET  http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/health`);
            console.log(`GET  http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools`);
            console.log(`GET  http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/status`);
            console.log('⚡ SYNC EXECUTION:');
            console.log(`POST http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools/execute`);
            console.log(`POST http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools/gleif`);
            console.log(`POST http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools/corporate`);
            console.log(`POST http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools/exim`);
            console.log(`POST http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools/risk`);
            console.log('🔄 ASYNC EXECUTION:');
            console.log(`POST http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/tools/execute-async`);
            console.log(`GET  http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/jobs/:jobId`);
            console.log(`GET  http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/jobs`);
            console.log(`DEL  http://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT}/api/v1/jobs/completed`);
            console.log('📡 WEBSOCKET:');
            console.log(`WS   ws://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT} (real-time async updates)`);
            console.log('📊 PROGRESSIVE STATE MONITORING:');
            console.log(`WS   ws://${ZK_PRET_HTTP_SERVER_HOST}:${ZK_PRET_HTTP_SERVER_PORT} (real-time state updates)`);
            console.log('=====================================\n');

            console.log('🎯 INTEGRATION SUCCESS:');
            console.log('• Backend ZK-PRET tools are now accessible via HTTP API');
            console.log('• Sync:  POST /api/v1/tools/execute (wait for result)');
            console.log('• Async: POST /api/v1/tools/execute-async (get job ID)');
            console.log('• Track: WebSocket for real-time async updates');
            console.log('• Monitor: Progressive state monitoring via WebSocket');
            console.log('• Your existing backend functionality remains unchanged');
            console.log('=====================================\n');

            console.log('📊 PROGRESSIVE STATE MONITORING FEATURES:');
            console.log('• Real-time before/after state capture');
            console.log('• WebSocket broadcasts for state changes');
            console.log('• Enhanced API responses with state data');
            console.log('• Compatible with all verification tools');
            console.log('• Direct execution mode only (no spawned processes)');
            console.log('=====================================\n');
        });
    } catch (error) {
        logger.error('Failed to start integrated HTTP server:', error);
        console.log('❌ Server startup failed, but this should not happen with the new timeout protection');
        process.exit(1);
    }
};

export { startServer };

process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
        logger.info('Integrated HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    server.close(() => {
        logger.info('Integrated HTTP server closed');
        process.exit(0);
    });
});

console.log('Starting server from integrated-server.js...');
startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});