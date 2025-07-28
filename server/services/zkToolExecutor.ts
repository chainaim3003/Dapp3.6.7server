import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { logger } from '../utils/logger.js';

export interface ToolExecutionResult {
    success: boolean;
    result: any;
    executionTime: string;
}

export interface ZKExecutorConfig {
    stdioPath: string;
    stdioBuildPath: string;
    timeout: number;
    executionMode: 'direct';
}

/**
 * Integrated ZK Tool Executor for ZK-PRET Backend
 * This executes the actual ZK-PRET tools from the backend codebase
 */
export class ZKToolExecutor {
    private config: ZKExecutorConfig;

    constructor() {
        console.log('=== INTEGRATED ZK-TOOL EXECUTOR INITIALIZATION ===');
        console.log('DEBUG: process.env.ZK_PRET_STDIO_PATH =', process.env.ZK_PRET_STDIO_PATH);

        // Use current directory as the base path since we're integrated
        this.config = {
            stdioPath: process.env.ZK_PRET_STDIO_PATH || process.cwd(),
            stdioBuildPath: process.env.ZK_PRET_STDIO_BUILD_PATH || './build/src/tests/with-sign',
            timeout: parseInt(process.env.ZK_PRET_SERVER_TIMEOUT || '1800000'),
            executionMode: 'direct' // Only direct execution
        };

        console.log('DEBUG: Final stdioPath =', this.config.stdioPath);
        console.log('DEBUG: Final stdioBuildPath =', this.config.stdioBuildPath);
        console.log('DEBUG: Final timeout =', this.config.timeout);
        console.log('DEBUG: Final executionMode =', this.config.executionMode);
        console.log('=====================================');
    }

    /**
     * NEW: Broadcast execution updates via WebSocket for progressive state monitoring
     */
    private broadcastExecutionUpdate(update: any) {
        try {
            // Access the global WebSocket server reference
            if ((global as any).wsServer) {
                const message = JSON.stringify({
                    type: 'execution_update',
                    ...update,
                    timestamp: new Date().toISOString(),
                    server: 'zk-pret-integrated-server'
                });

                (global as any).wsServer.clients.forEach((client: any) => {
                    if (client.readyState === 1) { // WebSocket.OPEN
                        client.send(message);
                    }
                });
            }
        } catch (error) {
            // Silently fail if WebSocket not available - don't break execution
            console.log('WebSocket broadcast failed (non-critical):', error);
        }
    }

    async initialize(): Promise<void> {
        try {
            // Add timeout to health check to prevent hanging
            const healthCheckPromise = this.healthCheck();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Health check timeout after 10 seconds')), 10000);
            });

            await Promise.race([healthCheckPromise, timeoutPromise]);
            logger.info('Integrated ZK Tool Executor initialized successfully');
        } catch (error) {
            logger.warn('Integrated ZK Tool Executor initialization failed', {
                error: error instanceof Error ? error.message : String(error),
                stdioPath: this.config.stdioPath
            });
            // Don't throw error - allow server to start even if health check fails
            console.log('⚠️  Health check failed but continuing server startup...');
        }
    }

    async healthCheck(): Promise<{ connected: boolean; status?: any }> {
        try {
            console.log('=== INTEGRATED ZK EXECUTOR HEALTH CHECK ===');
            console.log('Checking path:', this.config.stdioPath);

            // Use synchronous file access to avoid hanging
            const fs = await import('fs');

            // Check main path synchronously
            if (!fs.existsSync(this.config.stdioPath)) {
                console.log('❌ Main path does not exist');
                return { connected: false };
            }
            console.log('✅ Main path exists');

            const buildPath = path.join(this.config.stdioPath, this.config.stdioBuildPath);
            console.log('Checking build path:', buildPath);

            // Check if build directory exists synchronously
            if (!fs.existsSync(buildPath)) {
                console.log('⚠️  Build path does not exist, will try to build first');
            } else {
                console.log('✅ Build path exists');
            }

            // Check for key compiled JavaScript files instead of TypeScript sources
            const compiledFiles = [
                'GLEIFOptimMultiCompanyVerificationTestWithSign.js',
                'CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js',
                'EXIMOptimMultiCompanyVerificationTestWithSign.js'
            ];

            console.log('Checking for compiled JavaScript files:');
            let foundCompiledFiles = 0;
            for (const file of compiledFiles) {
                const filePath = path.join(this.config.stdioPath, this.config.stdioBuildPath, file);
                if (fs.existsSync(filePath)) {
                    console.log(`✅ Found: ${file}`);
                    foundCompiledFiles++;
                } else {
                    console.log(`❌ Missing: ${file}`);
                }
            }

            console.log('=========================');

            return {
                connected: foundCompiledFiles > 0,
                status: {
                    mode: 'integrated-server-direct-only',
                    path: this.config.stdioPath,
                    buildPath,
                    compiledFilesFound: foundCompiledFiles,
                    totalCompiledFiles: compiledFiles.length
                }
            };
        } catch (error) {
            console.log('❌ Integrated ZK Executor Health Check Failed:', error instanceof Error ? error.message : String(error));
            return { connected: false };
        }
    }

    getAvailableTools(): string[] {
        return [
            'get-GLEIF-verification-with-sign',
            'get-Corporate-Registration-verification-with-sign',
            'get-EXIM-verification-with-sign',
            'get-Composed-Compliance-verification-with-sign',
            'get-BSDI-compliance-verification',
            'get-BPI-compliance-verification',
            'get-RiskLiquidityACTUS-Verifier-Test_adv_zk',
            'get-RiskLiquidityACTUS-Verifier-Test_Basel3_Withsign',
            'get-RiskLiquidityBasel3Optim-Merkle-verification-with-sign',
            'get-RiskLiquidityAdvancedOptimMerkle-verification-with-sign',
            'get-StablecoinProofOfReservesRisk-verification-with-sign',
            'execute-composed-proof-full-kyc',
            'execute-composed-proof-financial-risk',
            'execute-composed-proof-business-integrity',
            'execute-composed-proof-comprehensive'
        ];
    }

    async executeTool(toolName: string, parameters: any = {}): Promise<ToolExecutionResult> {
        const startTime = Date.now();

        try {
            console.log('=== INTEGRATED SERVER TOOL EXECUTION START ===');
            console.log('Tool Name:', toolName);
            console.log('Parameters:', JSON.stringify(parameters, null, 2));

            const result = await this.executeIntegratedTool(toolName, parameters);
            const executionTime = Date.now() - startTime;

            console.log('=== INTEGRATED SERVER TOOL EXECUTION SUCCESS ===');
            console.log('Execution Time:', `${executionTime}ms`);
            console.log('Result Success:', result.success);
            console.log('==============================');

            return {
                success: result.success,
                result: result.result || {
                    status: result.success ? 'completed' : 'failed',
                    zkProofGenerated: result.success,
                    timestamp: new Date().toISOString(),
                    output: result.output || '',
                    executionMode: 'integrated-server-direct-only'
                },
                executionTime: `${executionTime}ms`
            };
        } catch (error) {
            const executionTime = Date.now() - startTime;

            console.log('=== INTEGRATED SERVER TOOL EXECUTION FAILED ===');
            console.log('Error:', error instanceof Error ? error.message : String(error));
            console.log('Execution Time:', `${executionTime}ms`);
            console.log('=============================');

            return {
                success: false,
                result: {
                    status: 'failed',
                    zkProofGenerated: false,
                    timestamp: new Date().toISOString(),
                    error: error instanceof Error ? error.message : 'Unknown error',
                    executionMode: 'integrated-server-direct-only'
                },
                executionTime: `${executionTime}ms`
            };
        }
    }

    async executeIntegratedTool(toolName: string, parameters: any = {}): Promise<any> {
        // Map tool names to actual TypeScript files in the backend
        const toolScriptMap: Record<string, string> = {
            'get-GLEIF-verification-with-sign': 'GLEIFOptimMultiCompanyVerificationTestWithSign.js',
            'get-Corporate-Registration-verification-with-sign': 'CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js',
            'get-EXIM-verification-with-sign': 'EXIMOptimMultiCompanyVerificationTestWithSign.js',
            'get-Composed-Compliance-verification-with-sign': 'ComposedRecursiveOptim3LevelVerificationTestWithSign.js',
            'get-BSDI-compliance-verification': 'BusinessStdIntegrityOptimMerkleVerificationTestWithSign.js',
            'get-BPI-compliance-verification': 'BusinessProcessIntegrityOptimMerkleVerificationFileTestWithSign.js',
            'get-RiskLiquidityACTUS-Verifier-Test_adv_zk': 'RiskLiquidityAdvancedOptimMerkleVerificationTestWithSign.js',
            'get-RiskLiquidityACTUS-Verifier-Test_Basel3_Withsign': 'RiskLiquidityBasel3OptimMerkleVerificationTestWithSign.js',
            'get-RiskLiquidityBasel3Optim-Merkle-verification-with-sign': 'RiskLiquidityBasel3OptimMerkleVerificationTestWithSign.js',
            'get-RiskLiquidityAdvancedOptimMerkle-verification-with-sign': 'RiskLiquidityAdvancedOptimMerkleVerificationTestWithSign.js',
            'get-StablecoinProofOfReservesRisk-verification-with-sign': 'RiskLiquidityStableCoinOptimMerkleVerificationTestWithSign.js',
            'execute-composed-proof-full-kyc': 'ComposedRecursiveOptim3LevelVerificationTestWithSign.js',
            'execute-composed-proof-financial-risk': 'ComposedRecursiveOptim3LevelVerificationTestWithSign.js',
            'execute-composed-proof-business-integrity': 'ComposedRecursiveOptim3LevelVerificationTestWithSign.js',
            'execute-composed-proof-comprehensive': 'ComposedRecursiveOptim3LevelVerificationTestWithSign.js'
        };

        const scriptFile = toolScriptMap[toolName];
        if (!scriptFile) {
            throw new Error(`Unknown tool: ${toolName}. Available tools: ${Object.keys(toolScriptMap).join(', ')}`);
        }

        console.log('=== INTEGRATED SERVER TOOL EXECUTION ===');
        console.log('Tool Name:', toolName);
        console.log('Script File:', scriptFile);
        console.log('============================');

        return await this.executeCompiledScript(scriptFile, parameters, toolName);
    }

    async executeCompiledScript(scriptFile: string, parameters: any = {}, toolName?: string): Promise<any> {
        const compiledScriptPath = path.join(this.config.stdioPath, this.config.stdioBuildPath, scriptFile);

        console.log('🔍 Checking for compiled JavaScript file...');
        console.log('Expected compiled script path:', compiledScriptPath);

        if (!existsSync(compiledScriptPath)) {
            console.log('❌ Compiled JavaScript file not found');
            throw new Error(`Compiled JavaScript file not found: ${compiledScriptPath}. Please run 'npm run build' first.`);
        }

        console.log('✅ Compiled JavaScript file found');
        console.log('🚀 Executing via direct execution only...');
        return await this.executeDirectly(compiledScriptPath, parameters, toolName);
    }

    async executeDirectly(scriptPath: string, parameters: any = {}, toolName?: string): Promise<any> {
        const startTime = Date.now();

        try {
            console.log('=== INTEGRATED SERVER DIRECT EXECUTION DEBUG ===');
            console.log('Script Path:', scriptPath);
            console.log('Working Directory:', this.config.stdioPath);
            console.log('Tool Name:', toolName);
            console.log('Parameters:', JSON.stringify(parameters, null, 2));
            console.log('================================================');

            // NEW: Broadcast execution started
            this.broadcastExecutionUpdate({
                type: 'execution_started',
                toolName,
                phase: 'before_state_process',
                message: `Starting ${toolName} execution - capturing initial state...`
            });

            // NEW: Enhanced console capture to detect state logging
            const originalConsoleLog = console.log;
            const originalConsoleError = console.error;
            let capturedBeforeState: any = null;
            let capturedAfterState: any = null;
            let currentPhase = 'before_state_process';
            let stdout = '';
            let stderr = '';

            console.log = (...args) => {
                const output = args.join(' ');
                stdout += output + '\n';

                // NEW: Detect before state logging
                if (output.includes('📊 Smart Contract State BEFORE Verification:')) {
                    currentPhase = 'before_state_capturing';
                    this.broadcastExecutionUpdate({
                        type: 'phase_update',
                        phase: 'before_state_capturing',
                        message: 'Capturing before state values...'
                    });
                }

                // NEW: Parse before state values as they're logged
                if (currentPhase === 'before_state_capturing') {
                    if (output.includes('Total Companies:')) {
                        const match = output.match(/Total Companies: (\d+)/);
                        if (match && !capturedBeforeState) {
                            capturedBeforeState = { totalCompaniesTracked: match[1] };
                        }
                    }
                    if (output.includes('Compliant Companies:')) {
                        const match = output.match(/Compliant Companies: (\d+)/);
                        if (match && capturedBeforeState) {
                            capturedBeforeState.compliantCompaniesCount = match[1];
                        }
                    }
                    if (output.includes('Global Compliance Score:')) {
                        const match = output.match(/Global Compliance Score: (\d+)/);
                        if (match && capturedBeforeState) {
                            capturedBeforeState.globalComplianceScore = match[1];
                            capturedBeforeState.totalVerificationsGlobal = '0'; // Default for before state
                            capturedBeforeState.registryVersion = '1'; // Default version
                            capturedBeforeState.companiesRootHash = 'initial-hash'; // Placeholder

                            // Before state fully captured
                            this.broadcastExecutionUpdate({
                                type: 'before_state_captured',
                                data: capturedBeforeState,
                                message: 'Before state successfully captured'
                            });
                            currentPhase = 'verification_process';
                            this.broadcastExecutionUpdate({
                                type: 'phase_update',
                                phase: 'verification_process',
                                message: 'Processing ZK verification...'
                            });
                        }
                    }
                }

                // NEW: Detect after state logging
                if (output.includes('📊 Smart Contract State AFTER Verification:')) {
                    currentPhase = 'after_state_capturing';
                    this.broadcastExecutionUpdate({
                        type: 'phase_update',
                        phase: 'after_state_capturing',
                        message: 'Capturing after state values...'
                    });
                }

                // NEW: Parse after state values
                if (currentPhase === 'after_state_capturing') {
                    if (output.includes('Total Companies:')) {
                        const match = output.match(/Total Companies: (\d+)/);
                        if (match && !capturedAfterState) {
                            capturedAfterState = { totalCompaniesTracked: match[1] };
                        }
                    }
                    if (output.includes('Compliant Companies:')) {
                        const match = output.match(/Compliant Companies: (\d+)/);
                        if (match && capturedAfterState) {
                            capturedAfterState.compliantCompaniesCount = match[1];
                        }
                    }
                    if (output.includes('Global Compliance Score:')) {
                        const match = output.match(/Global Compliance Score: (\d+)/);
                        if (match && capturedAfterState) {
                            capturedAfterState.globalComplianceScore = match[1];
                            capturedAfterState.totalVerificationsGlobal = '1'; // Incremented after verification
                            capturedAfterState.registryVersion = '1'; // Version after update
                            capturedAfterState.companiesRootHash = 'updated-hash'; // Updated hash

                            // After state fully captured
                            this.broadcastExecutionUpdate({
                                type: 'after_state_captured',
                                data: capturedAfterState,
                                message: 'After state successfully captured'
                            });
                            currentPhase = 'execution_completing';
                        }
                    }
                }

                // Call original console.log
                originalConsoleLog('📤 STDOUT:', output);
            };

            console.error = (...args) => {
                const output = args.join(' ');
                stderr += output + '\n';
                originalConsoleError('📥 STDERR:', output);
            };

            let result;
            const timeout = setTimeout(() => {
                throw new Error(`Direct execution timeout after ${this.config.timeout}ms`);
            }, this.config.timeout);

            try {
                // Convert Windows path to file:// URL for ES module import
                const fileUrl = pathToFileURL(scriptPath);
                console.log('File URL for import:', fileUrl.href);

                // Dynamic import of the compiled script
                const scriptModule = await import(fileUrl.href);

                // Call the appropriate direct execution function based on tool name
                switch (toolName) {
                    case 'get-GLEIF-verification-with-sign':
                        if (scriptModule.executeGLEIFVerificationDirect) {
                            result = await scriptModule.executeGLEIFVerificationDirect(parameters);
                        } else {
                            throw new Error('executeGLEIFVerificationDirect function not found in module');
                        }
                        break;

                    case 'get-BSDI-compliance-verification':
                        console.log('🎯 Executing BSDI verification via direct function call');
                        console.log('📋 Available functions in module:', Object.keys(scriptModule));

                        if (scriptModule.executeBSDIVerificationDirect) {
                            console.log('✅ executeBSDIVerificationDirect function found - calling now...');
                            result = await scriptModule.executeBSDIVerificationDirect(parameters);
                            console.log('✅ executeBSDIVerificationDirect completed successfully');
                        } else {
                            console.error('❌ executeBSDIVerificationDirect function not found in module');
                            console.error('Available functions:', Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function'));
                            throw new Error('executeBSDIVerificationDirect function not found in module. Available functions: ' + Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function').join(', '));
                        }
                        break;

                    case 'get-RiskLiquidityBasel3Optim-Merkle-verification-with-sign':
                        console.log('🎯 Executing Basel3 verification via direct function call');
                        console.log('📋 Available functions in module:', Object.keys(scriptModule));

                        if (scriptModule.executeBasel3VerificationDirect) {
                            console.log('✅ executeBasel3VerificationDirect function found - calling now...');
                            result = await scriptModule.executeBasel3VerificationDirect(parameters);
                            console.log('✅ executeBasel3VerificationDirect completed successfully');
                        } else {
                            console.error('❌ executeBasel3VerificationDirect function not found in module');
                            console.error('Available functions:', Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function'));
                            throw new Error('executeBasel3VerificationDirect function not found in module. Available functions: ' + Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function').join(', '));
                        }
                        break;

                    case 'get-EXIM-verification-with-sign':
                        if (scriptModule.executeEXIMVerificationDirect) {
                            result = await scriptModule.executeEXIMVerificationDirect(parameters);
                        } else {
                            throw new Error('executeEXIMVerificationDirect function not found in module');
                        }
                        break;

                    case 'get-Corporate-Registration-verification-with-sign':
                        if (scriptModule.executeCorporateRegistrationVerificationDirect) {
                            result = await scriptModule.executeCorporateRegistrationVerificationDirect(parameters);
                        } else {
                            throw new Error('executeCorporateRegistrationVerificationDirect function not found in module');
                        }
                        break;

                    case 'get-BPI-compliance-verification':
                        console.log('🎯 Executing BPI verification via direct function call');
                        console.log('📋 Available functions in module:', Object.keys(scriptModule));

                        if (scriptModule.executeBPIVerificationDirect) {
                            console.log('✅ executeBPIVerificationDirect function found - calling now...');
                            result = await scriptModule.executeBPIVerificationDirect(parameters);
                            console.log('✅ executeBPIVerificationDirect completed successfully');
                        } else {
                            console.error('❌ executeBPIVerificationDirect function not found in module');
                            console.error('Available functions:', Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function'));
                            throw new Error('executeBPIVerificationDirect function not found in module. Available functions: ' + Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function').join(', '));
                        }
                        break;

                    case 'get-StablecoinProofOfReservesRisk-verification-with-sign':
                        console.log('🎯 Executing Stablecoin verification via direct function call');
                        console.log('📋 Available functions in module:', Object.keys(scriptModule));

                        if (scriptModule.executeStablecoinVerificationDirect) {
                            console.log('✅ executeStablecoinVerificationDirect function found - calling now...');
                            result = await scriptModule.executeStablecoinVerificationDirect(parameters);
                            console.log('✅ executeStablecoinVerificationDirect completed successfully');
                        } else {
                            console.error('❌ executeStablecoinVerificationDirect function not found in module');
                            console.error('Available functions:', Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function'));
                            throw new Error('executeStablecoinVerificationDirect function not found in module. Available functions: ' + Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function').join(', '));
                        }
                        break;

                    case 'get-RiskLiquidityAdvancedOptimMerkle-verification-with-sign':
                        console.log('🎯 Executing Advanced Risk verification via direct function call');
                        console.log('📋 Available functions in module:', Object.keys(scriptModule));

                        if (scriptModule.executeAdvancedVerificationDirect) {
                            console.log('✅ executeAdvancedVerificationDirect function found - calling now...');
                            result = await scriptModule.executeAdvancedVerificationDirect(parameters);
                            console.log('✅ executeAdvancedVerificationDirect completed successfully');
                        } else {
                            console.error('❌ executeAdvancedVerificationDirect function not found in module');
                            console.error('Available functions:', Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function'));
                            throw new Error('executeAdvancedVerificationDirect function not found in module. Available functions: ' + Object.keys(scriptModule).filter(key => typeof scriptModule[key] === 'function').join(', '));
                        }
                        break;

                    default:
                        throw new Error(`Direct execution not implemented for tool: ${toolName}`);
                        break;
                }

                clearTimeout(timeout);

            } finally {
                // Restore console methods
                console.log = originalConsoleLog;
                console.error = originalConsoleError;
            }

            // NEW: Broadcast execution completed
            this.broadcastExecutionUpdate({
                type: 'execution_completed',
                result: result,
                message: 'Execution completed successfully',
                contractStateBefore: capturedBeforeState,
                contractStateAfter: capturedAfterState
            });

            const executionTime = Date.now() - startTime;

            console.log('=== INTEGRATED SERVER DIRECT EXECUTION COMPLETE ===');
            console.log('Success: true');
            console.log('Execution Time:', `${executionTime}ms`);
            console.log('Result Success:', result?.success);
            console.log('==================================================');

            // NEW: Enhanced response format with captured state data
            const response = {
                // System execution always successful if we reach here
                systemExecution: {
                    status: 'success',
                    executionCompleted: true,
                    scriptExecuted: true,
                    executionTime: new Date().toISOString(),
                    mode: 'direct-execution-only'
                },

                // Verification result from the direct function call
                verificationResult: {
                    success: result?.success || false,
                    zkProofGenerated: true,
                    status: result?.success ? 'verification_passed' : 'verification_failed',
                    reason: result?.success ? 'Verification completed successfully via direct execution' : 'Verification failed during direct execution'
                },

                // NEW: Add the captured state data
                contractStateBefore: capturedBeforeState,
                contractStateAfter: capturedAfterState,
                stateChanges: capturedBeforeState && capturedAfterState ? {
                    totalCompaniesChanged: parseInt(capturedAfterState.totalCompaniesTracked) - parseInt(capturedBeforeState.totalCompaniesTracked),
                    compliantCompaniesChanged: parseInt(capturedAfterState.compliantCompaniesCount) - parseInt(capturedBeforeState.compliantCompaniesCount),
                    globalScoreChanged: parseInt(capturedAfterState.globalComplianceScore) - parseInt(capturedBeforeState.globalComplianceScore)
                } : null,

                // Include the actual result data
                result: result,

                // Legacy compatibility
                status: 'completed',
                zkProofGenerated: true,
                timestamp: new Date().toISOString(),
                output: stdout,
                stderr: stderr,
                executionStrategy: 'Integrated Backend - Direct function execution only',
                executionMode: 'direct-execution-only',
                executionTime: `${executionTime}ms`
            };

            return {
                success: true,
                result: response
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;

            // NEW: Broadcast execution failed
            this.broadcastExecutionUpdate({
                type: 'execution_failed',
                error: error instanceof Error ? error.message : String(error),
                message: 'Execution failed'
            });

            console.log('=== INTEGRATED SERVER DIRECT EXECUTION FAILED ===');
            console.log('Error:', error instanceof Error ? error.message : String(error));
            console.log('Execution Time:', `${executionTime}ms`);
            console.log('=================================================');

            throw error;
        }
    }
}

export const zkToolExecutor = new ZKToolExecutor();