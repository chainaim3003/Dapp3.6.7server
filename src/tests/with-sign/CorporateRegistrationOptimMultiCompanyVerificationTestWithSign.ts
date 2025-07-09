import * as dotenv from 'dotenv';
dotenv.config();

import { getCorporateRegistrationOptimMultiCompanyVerificationWithSignUtils } from './CorporateRegistrationOptimMultiCompanyVerificationTestWithSignUtils.js';

// Direct execution function for server integration
export async function executeCorporateRegistrationVerificationDirect(parameters: any) {
    try {
        // Extract parameters
        const { companyName, companyNames, cin, typeOfNet } = parameters;
        
        // Determine company names to process
        let targetCompanyNames;
        if (companyNames && Array.isArray(companyNames)) {
            targetCompanyNames = companyNames;
        } else if (companyName) {
            targetCompanyNames = [companyName];
        } else {
            throw new Error('Company names are required');
        }
        
        // Validate company names
        const validCompanyNames = targetCompanyNames.map(name => String(name).trim()).filter(name => name.length > 0);
        if (validCompanyNames.length === 0) {
            throw new Error('At least one company name is required');
        }
        if (validCompanyNames.length > 10) {
            throw new Error('Maximum 10 companies supported in this demo');
        }
        
        console.log('🏢 Company Names:', validCompanyNames);
        console.log('📊 Total Companies to Process:', validCompanyNames.length);
        
        // Execute the verification
        const result = await getCorporateRegistrationOptimMultiCompanyVerificationWithSignUtils(validCompanyNames);
        
        console.log('\n🎯 Multi-Company Verification completed successfully!');
        console.log('\n📊 Final Summary:');
        console.log(`✅ Total Companies Processed: ${result.verificationResults.length}`);
        console.log(`✅ Successful Verifications: ${result.verificationResults.filter(r => !r.error).length}`);
        console.log(`❌ Failed Verifications: ${result.verificationResults.filter(r => r.error).length}`);
        console.log(`🏆 Compliant Companies: ${result.verificationResults.filter(r => r.isCompliant).length}`);
        console.log(`⚠️ Non-Compliant Companies: ${result.verificationResults.filter(r => !r.isCompliant && !r.error).length}`);
        
        console.log('\n🏢 Company Status Details:');
        result.verificationResults.forEach((company, index) => {
            const status = company.error ? '❌ ERROR' : (company.isCompliant ? '✅ COMPLIANT' : '⚠️ NON-COMPLIANT');
            console.log(`  ${index + 1}. ${company.companyName}: ${status}`);
            if (!company.error) {
                console.log(`     📄 CIN: ${company.cin}`);
                console.log(`     📊 Score: ${company.complianceScore}%`);
                console.log(`     🕒 Verified: ${new Date(Number(company.verificationTime)).toISOString()}`);
            } else {
                console.log(`     ❌ Error: ${company.error}`);
            }
        });
        
        console.log('\n🎉 Multi-Company Corporate Registration Verification Demo Completed Successfully!');
        console.log('📋 Features Demonstrated:');
        console.log('  ✅ Multiple company verification in single contract');
        console.log('  ✅ Global compliance statistics tracking');
        console.log('  ✅ Individual company state management');
        console.log('  ✅ Merkle tree-based company registry');
        console.log('  ✅ Aggregate compliance scoring');
        console.log('  ✅ Real-time MCA API integration');
        console.log('  ✅ Zero-knowledge proof generation and verification');
        console.log('  ✅ Smart contract state updates');
        
        // Return structured result for server
        return {
            success: true,
            verificationResults: result.verificationResults,
            summary: {
                totalCompanies: result.verificationResults.length,
                successfulVerifications: result.verificationResults.filter(r => !r.error).length,
                failedVerifications: result.verificationResults.filter(r => r.error).length,
                compliantCompanies: result.verificationResults.filter(r => r.isCompliant).length,
                nonCompliantCompanies: result.verificationResults.filter(r => !r.isCompliant && !r.error).length
            },
            timestamp: new Date().toISOString(),
            executionMode: 'direct-execution'
        };
        
    } catch (error) {
        console.error('💥 Error:', error);
        console.error('💥 Error Stack:', (error as Error).stack || 'No stack trace available');
        throw error;
    }
}

async function main() {
    // Get company names and network type from command line arguments
    const companyNamesArg = process.argv[2];
    //const typeOfNet = process.argv[3] || 'TESTNET';
    
    if (!companyNamesArg) {
        console.error('❌ Error: Company names are required');
        console.log('📖 Usage: node CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js "COMPANY1,COMPANY2" [TESTNET|MAINNET]');
        console.log('📝 Example: node CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js "Tata Consultancy Services Limited,Infosys Limited" "TESTNET"');
        console.log('📝 Example: node CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js "Wipro Limited,HCL Technologies Limited" "TESTNET"');
        process.exit(1);
    }
    
    // Parse company names from comma-separated string
    const companyNames = companyNamesArg.split(',').map(name => name.trim()).filter(name => name.length > 0);
    
    if (companyNames.length === 0) {
        console.error('❌ Error: At least one company name is required');
        process.exit(1);
    }
    
    if (companyNames.length > 10) {
        console.error('❌ Error: Maximum 10 companies supported in this demo');
        process.exit(1);
    }
    
    console.log('🏢 Company Names:', companyNames);
    //console.log('🌐 Network Type:', typeOfNet);
    console.log('📊 Total Companies to Process:', companyNames.length);
    
    try {
        const result = await getCorporateRegistrationOptimMultiCompanyVerificationWithSignUtils(companyNames);
        
        console.log('\n🎯 Multi-Company Verification completed successfully!');
        console.log('\n📊 Final Summary:');
        console.log(`✅ Total Companies Processed: ${result.verificationResults.length}`);
        console.log(`✅ Successful Verifications: ${result.verificationResults.filter(r => !r.error).length}`);
        console.log(`❌ Failed Verifications: ${result.verificationResults.filter(r => r.error).length}`);
        console.log(`🏆 Compliant Companies: ${result.verificationResults.filter(r => r.isCompliant).length}`);
        console.log(`⚠️ Non-Compliant Companies: ${result.verificationResults.filter(r => !r.isCompliant && !r.error).length}`);
        
        console.log('\n🏢 Company Status Details:');
        result.verificationResults.forEach((company, index) => {
            const status = company.error ? '❌ ERROR' : (company.isCompliant ? '✅ COMPLIANT' : '⚠️ NON-COMPLIANT');
            console.log(`  ${index + 1}. ${company.companyName}: ${status}`);
            if (!company.error) {
                console.log(`     📄 CIN: ${company.cin}`);
                console.log(`     📊 Score: ${company.complianceScore}%`);
                console.log(`     🕒 Verified: ${new Date(Number(company.verificationTime)).toISOString()}`);
            } else {
                console.log(`     ❌ Error: ${company.error}`);
            }
        });
        
        console.log('\n🎉 Multi-Company Corporate Registration Verification Demo Completed Successfully!');
        console.log('📋 Features Demonstrated:');
        console.log('  ✅ Multiple company verification in single contract');
        console.log('  ✅ Global compliance statistics tracking');
        console.log('  ✅ Individual company state management');
        console.log('  ✅ Merkle tree-based company registry');
        console.log('  ✅ Aggregate compliance scoring');
        console.log('  ✅ Real-time MCA API integration');
        console.log('  ✅ Zero-knowledge proof generation and verification');
        console.log('  ✅ Smart contract state updates');
        
        // Uncomment the line below if you want to see the full proof JSONs
        // console.log('📄 Generated Proofs:', result.proofs.map(p => p.toJSON()));
        
    } catch (error) {
        console.error('💥 Error:', error);
        console.error('💥 Error Stack:', (error as Error).stack || 'No stack trace available');
        process.exit(1);
    }
}

// Robust conditional execution - only run main if this script is executed directly
// This prevents main() from running when the module is imported
const isDirectExecution = () => {
    try {
        // Get the current file path from import.meta.url
        const currentFile = new URL(import.meta.url).pathname;
        
        // Get the main script path from process.argv[1]
        const mainScript = process.argv[1];
        
        // If we're being imported by the server, don't run main
        if (mainScript && mainScript.includes('integrated-server')) {
            return false;
        }
        
        // Only run main if this file is being executed directly
        return currentFile.endsWith('CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js') && 
               mainScript && mainScript.endsWith('CorporateRegistrationOptimMultiCompanyVerificationTestWithSign.js');
    } catch (error) {
        // If there's any error in detection, don't run main (safer for imports)
        return false;
    }
};

// Only run main if this is direct execution (not module import)
if (isDirectExecution()) {
    main().catch(err => {
        console.error('💥 Fatal Error:', err);
        console.error('💥 Fatal Error Stack:', err.stack);
        process.exit(1);
    });
}
