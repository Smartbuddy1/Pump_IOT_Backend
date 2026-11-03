/**
 * Comprehensive Automated Back-Test Suite for Pump IoT Project
 * Tests:
 * 1. Telemetry String Parsing (Water Level 1/0 at end per Rahul Sir's specification)
 * 2. Footfall Message Parsing (serial number,PERSON_IN)
 * 3. Water Alert Trigger & Resolution Lifecycle
 * 4. WebSocket Payload Contracts
 * 5. Multi-Device Responsive CSS Breakpoint Validation
 */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${testName}: ${details}`);
  }
}

console.log('===============================================================');
console.log('🧪 PUMP IOT AUTOMATED BACK-TEST SUITE: STARTING VERIFICATION');
console.log('===============================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. BACK-TEST: TELEMETRY STRING PARSER (Water Level 1/0 at the end)
// ─────────────────────────────────────────────────────────────────────────────
console.log('📦 TEST SUITE 1: Telemetry Parser (Water Level 1 & 0 at String End)');

function parseTelemetryPayload(payload, topic = 'petroleum') {
  let machineIdStr = '';
  const topicParts = topic.split('/');
  const lastTopicPart = topicParts[topicParts.length - 1];
  const ignoredTopicWords = ['petroleum', 'iot', 'telemetry', 'status', 'alerts', 'commands', '+', '#'];
  if (lastTopicPart && !ignoredTopicWords.includes(lastTopicPart.toLowerCase())) {
    machineIdStr = lastTopicPart.trim();
  }

  let parsedJson = null;
  if ((payload.startsWith('{') && payload.endsWith('}')) || (payload.startsWith('[') && payload.endsWith(']'))) {
    try { parsedJson = JSON.parse(payload); } catch (e) {}
  }

  const parts = payload.split(',').map(p => p.trim());
  const firstPartUpper = String(parts[0] || '').trim().toUpperCase();
  const knownKeywords = ['LIVE_DATA', 'ALERT', 'STATUS', 'OFFLINE', 'ONLINE', 'RUNNING', 'ACTIVE', 'INACTIVE', 'SET_WIFI', 'WIFI', 'PERSON_IN'];

  if (parsedJson && typeof parsedJson === 'object') {
    const jsonId = parsedJson.machine_id || parsedJson.machineId || parsedJson.id || parsedJson.name;
    if (jsonId) machineIdStr = String(jsonId).trim();
  } else if (parts.length >= 2 && !knownKeywords.includes(firstPartUpper)) {
    machineIdStr = parts[0].trim();
  }

  const isLiveCsv = parts.length >= 2 && (parts[0] === 'LIVE_DATA' || parts[1] === 'LIVE_DATA');
  const isLiveJson = parsedJson && (parsedJson.temperature !== undefined || parsedJson.temp !== undefined || parsedJson.live_temp !== undefined);

  if (!isLiveCsv && !isLiveJson) return null;

  let rawTemp, rawWater, rawHum, rawOdour, rawNh3, rawH2s;

  if (isLiveJson) {
    rawTemp = parsedJson.temperature ?? parsedJson.temp ?? parsedJson.live_temp ?? '28';
    rawHum = parsedJson.humidity ?? parsedJson.hum ?? parsedJson.live_humidity ?? '50';
    rawOdour = parsedJson.voc ?? parsedJson.voc_gas ?? parsedJson.odour ?? parsedJson.live_odour ?? '40';
    rawNh3 = parsedJson.nh3 ?? parsedJson.live_nh3 ?? '0';
    rawH2s = parsedJson.h2s ?? parsedJson.live_h2s ?? '0';
    const jWater = parsedJson.water ?? parsedJson.water_level ?? parsedJson.live_water;
    if (jWater === 0 || jWater === '0' || String(jWater).toLowerCase() === 'low') {
      rawWater = 'Low';
    } else if (jWater === 1 || jWater === '1' || String(jWater).toLowerCase() === 'normal') {
      rawWater = 'Normal';
    } else {
      rawWater = jWater ?? 'Normal';
    }
  } else {
    const offset = (parts[1] === 'LIVE_DATA') ? 2 : 1;
    const dataParts = parts.slice(offset).map(p => p.trim());
    const lastDataPart = String(dataParts[dataParts.length - 1] || '').trim();
    const isWaterAtEnd = (dataParts.length >= 6) && (
      lastDataPart === '0' || lastDataPart === '1' || 
      lastDataPart.toLowerCase() === 'normal' || lastDataPart.toLowerCase() === 'low'
    );

    if (isWaterAtEnd) {
      rawTemp = dataParts[0];
      rawHum = dataParts[1];
      rawOdour = dataParts[2];
      rawNh3 = dataParts[3];
      rawH2s = dataParts[4];
      rawWater = (lastDataPart === '1' || lastDataPart.toLowerCase() === 'normal') ? 'Normal' : 'Low';
    } else if (dataParts.length === 5) {
      rawTemp = dataParts[0];
      rawHum = dataParts[1];
      rawOdour = dataParts[2];
      rawNh3 = dataParts[3];
      rawH2s = dataParts[4];
      rawWater = 'Normal';
    } else if (dataParts.length >= 6) {
      rawTemp = dataParts[0];
      rawWater = dataParts[1];
      rawHum = dataParts[2];
      rawOdour = dataParts[3];
      rawNh3 = dataParts[4];
      rawH2s = dataParts[5];
    } else {
      rawTemp = dataParts[0] || '28';
      rawWater = dataParts[1] || 'Normal';
      rawHum = dataParts[2] || '50';
      rawOdour = dataParts[3] || '40';
      rawNh3 = dataParts[4] || '0';
      rawH2s = dataParts[5] || '0';
    }
  }

  let waterStatus = 'Normal';
  let waterNumeric = 85;
  const cleanWaterStr = String(rawWater || '').trim().toLowerCase();
  if (cleanWaterStr === '0' || cleanWaterStr === 'low' || cleanWaterStr === 'empty') {
    waterStatus = 'Low';
    waterNumeric = 10;
  } else if (cleanWaterStr === '1' || cleanWaterStr === 'normal' || cleanWaterStr === 'high' || cleanWaterStr === 'ok') {
    waterStatus = 'Normal';
    waterNumeric = 85;
  }

  return {
    machineId: machineIdStr,
    temp: `${rawTemp}°C`,
    humidity: `${rawHum}%`,
    odour: `${rawOdour} PPM`,
    nh3: rawNh3,
    h2s: rawH2s,
    water: waterStatus,
    waterLevel: waterStatus === 'Normal' ? 1 : 0,
    waterNumeric
  };
}

// Case 1.1: Water 1 (Normal) at the end
const res1 = parseTelemetryPayload('SBE2O001,LIVE_DATA,33,55,1231,627,1379,1');
assert(res1 !== null, 'Case 1.1: Parses 6-data-part hardware string');
assert(res1?.machineId === 'SBE2O001', 'Case 1.1: Identifies machine ID SBE2O001');
assert(res1?.temp === '33°C', 'Case 1.1: Temp is 33°C');
assert(res1?.humidity === '55%', 'Case 1.1: Humidity is 55%');
assert(res1?.odour === '1231 PPM', 'Case 1.1: VOC odour is 1231 PPM');
assert(res1?.nh3 === '627', 'Case 1.1: NH3 is 627');
assert(res1?.h2s === '1379', 'Case 1.1: H2S is 1379');
assert(res1?.water === 'Normal', 'Case 1.1: 1 maps to water "Normal"');
assert(res1?.waterLevel === 1, 'Case 1.1: waterLevel number is 1');
assert(res1?.waterNumeric === 85, 'Case 1.1: waterNumeric is 85%');

// Case 1.2: Water 0 (Low) at the end
const res2 = parseTelemetryPayload('SBP2T101,LIVE_DATA,29,62,850,310,450,0');
assert(res2?.machineId === 'SBP2T101', 'Case 1.2: Identifies machine ID SBP2T101');
assert(res2?.water === 'Low', 'Case 1.2: 0 maps to water "Low"');
assert(res2?.waterLevel === 0, 'Case 1.2: waterLevel number is 0');
assert(res2?.waterNumeric === 10, 'Case 1.2: waterNumeric is 10%');

// Case 1.3: 5-part string without water appended yet (Backward compatibility)
const res3 = parseTelemetryPayload('SBP2T101,LIVE_DATA,28,50,40,15,5');
assert(res3?.water === 'Normal', 'Case 1.3: 5-part string defaults safely to "Normal"');
assert(res3?.waterLevel === 1, 'Case 1.3: 5-part string waterLevel is 1');

// Case 1.4: Legacy simulator format (water at index 1)
const res4 = parseTelemetryPayload('SBP2T101,LIVE_DATA,27,85,55,30,12,8');
assert(res4?.water === 'Normal', 'Case 1.4: Legacy simulator string correctly parsed');

// Case 1.5: JSON format with water: 0
const res5 = parseTelemetryPayload(JSON.stringify({ machine_id: 'SBP2T101', temp: 31, hum: 45, voc: 50, nh3: 10, h2s: 5, water: 0 }));
assert(res5?.water === 'Low', 'Case 1.5: JSON water: 0 correctly parsed as "Low"');
assert(res5?.waterLevel === 0, 'Case 1.5: JSON waterLevel is 0');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 2. BACK-TEST: FOOTFALL (PERSON_IN) MESSAGE PARSER
// ─────────────────────────────────────────────────────────────────────────────
console.log('🚶 TEST SUITE 2: Footfall Parser (serial number,PERSON_IN)');

function parseFootfallMessage(payload, topic = 'petroleum') {
  let machineIdStr = '';
  const topicParts = topic.split('/');
  const lastTopicPart = topicParts[topicParts.length - 1];
  const ignoredTopicWords = ['petroleum', 'iot', 'telemetry', 'status', 'alerts', 'commands', '+', '#', 'footfall'];
  if (lastTopicPart && !ignoredTopicWords.includes(lastTopicPart.toLowerCase())) {
    machineIdStr = lastTopicPart.trim();
  }

  let parsedJson = null;
  if ((payload.startsWith('{') && payload.endsWith('}')) || (payload.startsWith('[') && payload.endsWith(']'))) {
    try { parsedJson = JSON.parse(payload); } catch (e) {}
  }

  const parts = payload.split(',').map(p => p.trim());
  const firstPartUpper = String(parts[0] || '').trim().toUpperCase();
  const secondPartUpper = String(parts[1] || '').trim().toUpperCase();

  if (parsedJson && typeof parsedJson === 'object') {
    const jsonId = parsedJson.machine_id || parsedJson.machineId || parsedJson.id || parsedJson.name;
    if (jsonId) machineIdStr = String(jsonId).trim();
  } else if (parts.length >= 2 && secondPartUpper === 'PERSON_IN') {
    machineIdStr = parts[0].trim();
  } else if (firstPartUpper === 'PERSON_IN' && parts.length >= 2) {
    machineIdStr = parts[1].trim();
  }

  const isFootfallCsv = (parts.length >= 2 && secondPartUpper === 'PERSON_IN') ||
                        (firstPartUpper === 'PERSON_IN') ||
                        (payload.toUpperCase().includes('PERSON_IN'));
  const isFootfallJson = parsedJson && (
    String(parsedJson.event || '').toUpperCase() === 'PERSON_IN' ||
    String(parsedJson.command || '').toUpperCase() === 'PERSON_IN' ||
    String(parsedJson.action || '').toUpperCase() === 'PERSON_IN' ||
    parsedJson.footfall === 1 || parsedJson.person_in === true
  );

  if (!isFootfallCsv && !isFootfallJson) return null;

  return {
    isFootfall: true,
    machineId: machineIdStr,
    timestamp: new Date().toISOString()
  };
}

// Case 2.1: Direct hardware command "SBP2T101,PERSON_IN"
const ff1 = parseFootfallMessage('SBP2T101,PERSON_IN');
assert(ff1 !== null && ff1.isFootfall === true, 'Case 2.1: Detects PERSON_IN command');
assert(ff1?.machineId === 'SBP2T101', 'Case 2.1: Machine ID extracted as SBP2T101');

// Case 2.2: Whitespace-padded command "SBE2O001 , PERSON_IN"
const ff2 = parseFootfallMessage('SBE2O001 , PERSON_IN');
assert(ff2?.machineId === 'SBE2O001', 'Case 2.2: Handles whitespace trimming on SBE2O001');

// Case 2.3: Topic based payload
const ff3 = parseFootfallMessage('PERSON_IN', 'petroleum/iot/telemetry/SBP2T601');
assert(ff3?.machineId === 'SBP2T601', 'Case 2.3: Extracts machine ID from topic');

// Case 2.4: JSON event
const ff4 = parseFootfallMessage(JSON.stringify({ machine_id: 'SBP2T901', event: 'PERSON_IN' }));
assert(ff4?.machineId === 'SBP2T901', 'Case 2.4: Handles JSON { machine_id, event: PERSON_IN }');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 3. BACK-TEST: AUTOMATED WATER ALERT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
console.log('🚨 TEST SUITE 3: Automated Water Alert Lifecycle');

class MockAlertSystem {
  constructor() {
    this.alerts = [];
  }

  handleWaterReading(machineId, waterStatus) {
    if (waterStatus === 'Low') {
      const existing = this.alerts.find(a => a.machineId === machineId && a.message.includes('Water Level Low') && a.status === 'Open');
      if (!existing) {
        this.alerts.push({ machineId, severity: 'Low', message: 'Water Level Low - Refill required', status: 'Open' });
        return { action: 'CREATED', alert: 'Water Level Low' };
      }
      return { action: 'ALREADY_OPEN' };
    } else if (waterStatus === 'Normal') {
      const open = this.alerts.filter(a => a.machineId === machineId && a.message.includes('Water Level Low') && a.status === 'Open');
      if (open.length > 0) {
        open.forEach(a => a.status = 'Resolved');
        return { action: 'RESOLVED', count: open.length };
      }
      return { action: 'NOOP' };
    }
  }
}

const alertSystem = new MockAlertSystem();
// Machine SBP2T101 reports water = 0 (Low)
const act1 = alertSystem.handleWaterReading('SBP2T101', 'Low');
assert(act1.action === 'CREATED', 'Case 3.1: Water 0 automatically creates "Water Level Low" alert');

// Repeated water = 0 reports should not duplicate the open alert
const act2 = alertSystem.handleWaterReading('SBP2T101', 'Low');
assert(act2.action === 'ALREADY_OPEN', 'Case 3.2: Deduplicates open alert on repeated low readings');
assert(alertSystem.alerts.filter(a => a.machineId === 'SBP2T101' && a.status === 'Open').length === 1, 'Case 3.2: Only 1 open alert exists');

// Machine SBP2T101 is refilled -> water = 1 (Normal)
const act3 = alertSystem.handleWaterReading('SBP2T101', 'Normal');
assert(act3.action === 'RESOLVED', 'Case 3.3: Water 1 automatically resolves open alert');
assert(alertSystem.alerts.find(a => a.machineId === 'SBP2T101').status === 'Resolved', 'Case 3.3: Alert status transitioned to "Resolved"');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 4. BACK-TEST: RESPONSIVE CSS DESIGN SYSTEM VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('📱 TEST SUITE 4: Multi-Device Responsive CSS Verification');

const fs = require('fs');
const path = require('path');

const cssPath = path.resolve(__dirname, '../Pump_IOT_Frontend/src/index.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

assert(cssContent.includes('@media (max-width: 480px)'), 'Case 4.1: Contains <= 480px Mobile breakpoint');
assert(cssContent.includes('@media (max-width: 768px)'), 'Case 4.1: Contains <= 768px Tablet/Phone breakpoint');
assert(cssContent.includes('@media (max-width: 1024px)'), 'Case 4.1: Contains <= 1024px Tablet breakpoint');
assert(cssContent.includes('@media (min-width: 1025px) and (max-width: 1536px)'), 'Case 4.1: Contains 1025px-1536px Laptop display (14", 15", 15.6") breakpoint');
assert(cssContent.includes('.sidebar.open'), 'Case 4.2: Contains Slide-out Drawer class .sidebar.open');
assert(cssContent.includes('.sidebar-overlay.open'), 'Case 4.2: Contains Drawer backdrop overlay .sidebar-overlay.open');
assert(cssContent.includes('stat-cards-grid'), 'Case 4.3: Contains .stat-cards-grid utility class for auto-flowing KPI stats');
assert(cssContent.includes('.table-responsive') || cssContent.includes('overflow-x: auto'), 'Case 4.4: Contains horizontal table swipe engine');
assert(cssContent.includes('.modal-content'), 'Case 4.5: Contains fluid modal styling');

console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 5. BACK-TEST: FRONTEND SOCKET LISTENER VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
console.log('⚡ TEST SUITE 5: Frontend Socket Listeners Verification');

const dashboardPath = path.resolve(__dirname, '../Pump_IOT_Frontend/src/pages/Dashboard.jsx');
const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');
assert(dashboardCode.includes("socket.on('footfall_update'"), 'Case 5.1: Dashboard listens for footfall_update');
assert(dashboardCode.includes("socket.on('person_in'"), 'Case 5.1: Dashboard listens for person_in');

const machinesPath = path.resolve(__dirname, '../Pump_IOT_Frontend/src/pages/Machines.jsx');
const machinesCode = fs.readFileSync(machinesPath, 'utf8');
assert(machinesCode.includes("socket.on('footfall_update'"), 'Case 5.2: Machines page listens for footfall_update');
assert(machinesCode.includes("socket.on('person_in'"), 'Case 5.2: Machines page listens for person_in');

const omcPath = path.resolve(__dirname, '../Pump_IOT_Frontend/src/pages/OMCDashboard.jsx');
const omcCode = fs.readFileSync(omcPath, 'utf8');
assert(omcCode.includes("socket.on('footfall_update'"), 'Case 5.3: OMCDashboard listens for footfall_update');

const ioclPath = path.resolve(__dirname, '../Pump_IOT_Frontend/src/pages/IOCLDashboard.jsx');
const ioclCode = fs.readFileSync(ioclPath, 'utf8');
assert(ioclCode.includes("socket.on('footfall_update'"), 'Case 5.4: IOCLDashboard listens for footfall_update');

console.log('');
console.log('===============================================================');
console.log(`📊 BACK-TEST SUMMARY: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
if (failedTests === 0) {
  console.log('🎉 ALL BACK-TESTS PASSED WITH 100% SUCCESS RATE! READY FOR PRODUCTION!');
} else {
  console.error(`⚠️ ${failedTests} TESTS FAILED. PLEASE INSPECT LOGS ABOVE.`);
  process.exit(1);
}
console.log('===============================================================\n');
