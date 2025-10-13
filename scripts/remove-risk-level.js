#!/usr/bin/env node

/**
 * riskLevel 필드를 모든 백엔드 파일에서 제거하는 스크립트
 */

const fs = require('fs');
const path = require('path');

function removeRiskLevelFromFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // riskLevel: 'VALUE', 패턴 제거
    const riskLevelPattern = /,?\s*riskLevel:\s*['"][^'"]*['"],?\s*/g;
    if (riskLevelPattern.test(content)) {
      content = content.replace(riskLevelPattern, '');
      modified = true;
    }

    // riskLevel 변수 선언 제거
    const riskLevelVarPattern = /const\s+riskLevel\s*=\s*[^;]+;?\s*/g;
    if (riskLevelVarPattern.test(content)) {
      content = content.replace(riskLevelVarPattern, '');
      modified = true;
    }

    // riskLevel 관련 조건문 제거
    const riskLevelConditionPattern = /if\s*\([^)]*riskLevel[^)]*\)\s*{[^}]*}/g;
    if (riskLevelConditionPattern.test(content)) {
      content = content.replace(riskLevelConditionPattern, '');
      modified = true;
    }

    // riskLevel 관련 필터 제거
    const riskLevelFilterPattern = /\.filter\([^)]*riskLevel[^)]*\)/g;
    if (riskLevelFilterPattern.test(content)) {
      content = content.replace(riskLevelFilterPattern, '.filter(() => false)');
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ Removed riskLevel from: ${filePath}`);
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
  }
}

function processDirectory(dirPath) {
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !item.includes('node_modules') && !item.includes('.git')) {
      processDirectory(fullPath);
    } else if (stat.isFile() && item.endsWith('.js')) {
      removeRiskLevelFromFile(fullPath);
    }
  }
}

// 백엔드 서비스 디렉토리만 처리
const backendServicesPath = path.join(__dirname, '../backend/services');
if (fs.existsSync(backendServicesPath)) {
  console.log('🔄 Removing riskLevel from backend services...');
  processDirectory(backendServicesPath);
  console.log('✅ riskLevel removal completed!');
} else {
  console.error('❌ Backend services directory not found');
}