/**
 * Paper Protector - Main Interface Logic
 */

// Configuration
const CONFIG = {
    paperWidthMm: 50,
    defaultPaperLengthMm: 210,
    pixelsPerMm: 3, // Scale factor for visualization
    scanSpeed: 128, // Fan speed during scan
    dryFanSpeed: 255,
    dryHeaterPower: 255,
    wetThresholdPercent: 5.0, // Relative humidity above zero to consider "wet"
    scanStepMm: 5, // Resolution of scanning
    motorMaxSpeed: 200, // Assuming some max speed for calculations
    motorSpeedRevPerSec: 2.0, // Motor speed: 2 revolutions per second
    mmPerRevolution: 1.498 // mm per revolution (must match Arduino)
};

// State
const state = {
    isConnected: false,
    currentTemp: 0,
    currentHumidity: 0,
    currentPositionMm: 0,
    paperLengthMm: CONFIG.defaultPaperLengthMm,

    // System Components
    fanPower: 0,
    heaterPower: 0,

    // Calibration
    zeroTemp: null,
    zeroHumidity: null,
    isCalibrated: false,

    // Operation
    systemState: 'IDLE', // IDLE, SCANNING, DRYING, FINISHED

    // Data
    scanData: [], // Array of {position, humidity}
    wetSegments: [], // Array of {start, end, humidity}

    // Drying
    dryingDirection: 1, // 1 for right/down, -1 for left/up
    dryingBounds: { min: 0, max: 0 },
    dryingStats: null, // Drying progress statistics
    lastAnalysisTime: null, // Last time wet spots were re-analyzed

    // Motion simulation
    targetPositionMm: 0, // Target position from motor command
    simulatedPositionMm: 0, // Simulated current position
    isSimulating: false, // Is simulation active
    simulationInterval: null, // Interval timer for simulation

    // System Components
    fanPower: 0,
    heaterPower: 0
};

// DOM Elements
const elements = {
    paperStrip: document.getElementById('paper-strip'),
    scanCursor: document.getElementById('scan-cursor'),
    wetSpotsLayer: document.getElementById('wet-spots-layer'),
    humidityBars: document.getElementById('humidity-bars'),
    currentTemp: document.getElementById('current-temp'),
    currentHumidity: document.getElementById('current-humidity'),
    currentPosition: document.getElementById('current-position'),
    progressBar: document.getElementById('progress-bar'),
    btnCalibrate: document.getElementById('btn-calibrate-zero'),
    btnResetCal: document.getElementById('btn-reset-calibration'),
    btnStartScan: document.getElementById('btn-start-scan'),
    btnCalibrateMotor: document.getElementById('btn-calibrate-motor'),
    btnHomeMotor: document.getElementById('btn-home-motor'),
    btnStop: document.getElementById('btn-stop-all'),
    btnSetLength: document.getElementById('btn-set-length'),
    inputLength: document.getElementById('paper-length-input'),
    calibrationStatus: document.getElementById('calibration-status'),
    systemState: document.getElementById('system-state'),
    connectionStatus: document.getElementById('connection-status'),
    // System status indicators
    fanStatusLight: document.getElementById('fan-status-light'),
    fanPowerValue: document.getElementById('fan-power-value'),
    heaterStatusLight: document.getElementById('heater-status-light'),
    heaterPowerValue: document.getElementById('heater-power-value')
};

// Initialize PubSub
const wsUrl = 'ws://localhost:8000/ws';
const pubsub = new PubSubClient(wsUrl);

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initPubSub();
});

function initUI() {
    // Set initial paper size
    updatePaperVisuals();

    // Event Listeners
    elements.btnSetLength.addEventListener('click', () => {
        const len = parseInt(elements.inputLength.value);
        if (len >= 5 && len <= 30) {
            state.paperLengthMm = len * 10;
            updatePaperVisuals();
        }
    });

    elements.btnCalibrate.addEventListener('click', calibrateZero);
    elements.btnResetCal.addEventListener('click', resetCalibration);
    elements.btnStartScan.addEventListener('click', startScan);
    elements.btnCalibrateMotor.addEventListener('click', calibrateMotor);
    elements.btnHomeMotor.addEventListener('click', homeMotor);
    elements.btnStop.addEventListener('click', stopAll);
}

function initPubSub() {
    pubsub.onStatusChange((status) => {
        elements.connectionStatus.className = `status-indicator ${status}`;
        elements.connectionStatus.textContent = status;
        state.isConnected = (status === 'connected');
        updateButtonStates();
    });

    pubsub.connect();

    // Subscribe to topics
    pubsub.subscribe('dht/temperature', handleTemp);
    pubsub.subscribe('dht/humidity', handleHumidity);
    pubsub.subscribe('motor/position', handlePosition);
    pubsub.subscribe('fan/status', handleFanStatus);
    pubsub.subscribe('heater/status', handleHeaterStatus);
    pubsub.subscribe('system/status', (topic, payload) => {
        console.log('System status:', payload);
    });

    // Query initial status after connection
    setTimeout(() => {
        if (state.isConnected) {
            pubsub.publish('fan/query', '');
            pubsub.publish('heater/query', '');
        }
    }, 500);
}

// --- Core Logic ---

function updatePaperVisuals() {
    const heightPx = state.paperLengthMm * CONFIG.pixelsPerMm;
    elements.paperStrip.style.height = `${heightPx}px`;

    // Generate ruler marks
    const rulerContainer = document.querySelector('.ruler-marks');
    rulerContainer.innerHTML = '';

    for (let mm = 0; mm <= state.paperLengthMm; mm += 10) {
        const mark = document.createElement('div');
        mark.className = 'ruler-mark';
        if (mm % 50 === 0) mark.classList.add('major');
        mark.style.top = `${mm * CONFIG.pixelsPerMm}px`;

        if (mm % 50 === 0) {
            const label = document.createElement('div');
            label.className = 'ruler-label';
            label.textContent = `${mm / 10}cm`;
            label.style.top = `${mm * CONFIG.pixelsPerMm}px`;
            rulerContainer.appendChild(label);
        }

        rulerContainer.appendChild(mark);
    }
}

function handleTemp(topic, payload) {
    const val = parseFloat(payload);
    if (!isNaN(val)) {
        state.currentTemp = val;
        const displayVal = state.zeroTemp !== null ? (val - state.zeroTemp) : val;
        elements.currentTemp.textContent = displayVal.toFixed(1);
    }
}

function handleHumidity(topic, payload) {
    const val = parseFloat(payload);
    if (!isNaN(val)) {
        state.currentHumidity = val;
        // 计算相对湿度 (相对于校准的零点)
        const relativeHumidity = state.zeroHumidity !== null ? (val - state.zeroHumidity) : val;
        elements.currentHumidity.textContent = relativeHumidity.toFixed(1);

        // 扫描过程: 记录数据用于初始分析
        if (state.systemState === 'SCANNING') {
            recordScanData(state.currentPositionMm, relativeHumidity);
        }

        // 干燥过程: 持续记录和更新
        if (state.systemState === 'DRYING') {
            // 持续记录数据点 (用于动态分析)
            recordDryingData(state.currentPositionMm, relativeHumidity);

            // 更新可视化 (实时反馈)
            updateWetSpotVisual(state.currentPositionMm, relativeHumidity);

            // 检查干燥进度 (智能判断)
            checkDryingProgress(state.currentPositionMm, relativeHumidity);
        }
    }
}

function updateWetSpotVisual(pos, humidity) {
    // Find wet spots near this position and update/remove them
    // This is a simple visual effect to show "drying"
    const spots = document.querySelectorAll('.wet-spot');
    const thresholdPx = 10 * CONFIG.pixelsPerMm; // 10mm radius
    const currentTopPx = pos * CONFIG.pixelsPerMm;

    spots.forEach(spot => {
        const spotTopPx = parseFloat(spot.style.top);
        if (Math.abs(spotTopPx - currentTopPx) < thresholdPx) {
            if (humidity <= CONFIG.wetThresholdPercent) {
                // It's dry now, fade it out
                spot.style.opacity = '0.2';
                spot.style.backgroundColor = '#2ecc71'; // Green for dry
            } else {
                // Still wet, update intensity
                const intensity = Math.min(1.0, (humidity - CONFIG.wetThresholdPercent) / 20);
                spot.style.backgroundColor = `rgba(0, 100, 255, ${0.2 + intensity * 0.5})`;
                spot.querySelector('.wet-spot-label').textContent = `${humidity.toFixed(1)}%`;
            }
        }
    });
}

function handlePosition(topic, payload) {
    // Payload format: "revolutions.xx,mm.xx"
    const parts = payload.split(',');
    if (parts.length === 2) {
        const mm = parseFloat(parts[1]);
        if (!isNaN(mm)) {
            // Stop any ongoing simulation
            stopPositionSimulation();

            // Update actual position
            state.currentPositionMm = mm;
            state.simulatedPositionMm = mm;
            updatePositionVisuals(mm);

            // Check scan bounds
            if (state.systemState === 'SCANNING') {
                if (mm >= state.paperLengthMm - 2) { // Tolerance
                    finishScan();
                }
            }

            // Check drying bounds
            if (state.systemState === 'DRYING') {
                handleDryingMovement(mm);
            }
        }
    }
}

function handleFanStatus(topic, payload) {
    const power = parseInt(payload);
    if (!isNaN(power)) {
        state.fanPower = power;
        updateFanDisplay(power);
    }
}

function handleHeaterStatus(topic, payload) {
    const power = parseInt(payload);
    if (!isNaN(power)) {
        state.heaterPower = power;
        updateHeaterDisplay(power);
    }
}

function updateFanDisplay(power) {
    elements.fanPowerValue.textContent = power;
    if (power > 0) {
        elements.fanStatusLight.classList.add('on');
        elements.fanStatusLight.classList.remove('off');
    } else {
        elements.fanStatusLight.classList.add('off');
        elements.fanStatusLight.classList.remove('on');
    }
}

function updateHeaterDisplay(power) {
    elements.heaterPowerValue.textContent = power;
    if (power > 0) {
        elements.heaterStatusLight.classList.add('on');
        elements.heaterStatusLight.classList.remove('off');
    } else {
        elements.heaterStatusLight.classList.add('off');
        elements.heaterStatusLight.classList.remove('on');
    }
}

function updatePositionVisuals(mm) {
    // Update position text
    elements.currentPosition.textContent = mm.toFixed(1);

    // Update bottom progress bar
    const percent = Math.min(100, Math.max(0, (mm / state.paperLengthMm) * 100));
    elements.progressBar.style.width = `${percent}%`;

    // Update cursor on paper (visible red line)
    const topPx = mm * CONFIG.pixelsPerMm;
    elements.scanCursor.style.top = `${topPx}px`;
    elements.scanCursor.style.display = 'block'; // Ensure visible

    // Debug logging
    console.log(`Position updated: ${mm.toFixed(1)}mm (${percent.toFixed(1)}%, ${topPx}px)`);
}

// --- Calibration ---

function calibrateZero() {
    if (state.currentTemp !== 0 && state.currentHumidity !== 0) {
        state.zeroTemp = state.currentTemp;
        state.zeroHumidity = state.currentHumidity;
        state.isCalibrated = true;

        elements.calibrationStatus.textContent = `Calibrated (T:${state.zeroTemp.toFixed(1)}, H:${state.zeroHumidity.toFixed(1)})`;
        elements.calibrationStatus.style.color = 'green';
        updateButtonStates();
    }
}

function resetCalibration() {
    state.zeroTemp = null;
    state.zeroHumidity = null;
    state.isCalibrated = false;

    elements.calibrationStatus.textContent = 'Not Calibrated';
    elements.calibrationStatus.style.color = '#666';
    updateButtonStates();
}

function calibrateMotor() {
    /**
     * 校准电机 - 设定当前位置为0点
     */
    if (!state.isConnected) {
        alert('WebSocket未连接');
        return;
    }

    if (confirm('确定要将当前位置校准为 0 圈 0mm 吗?')) {
        console.log('Calibrating motor position to zero...');
        pubsub.publish('motor/calibrate', '');

        // 更新本地状态
        state.currentPositionMm = 0;
        state.simulatedPositionMm = 0;
        updatePositionVisuals(0);
    }
}

function homeMotor() {
    /**
     * 手动回零电机
     */
    if (!state.isConnected) {
        alert('WebSocket未连接');
        return;
    }

    if (confirm('确定要将电机移动到 0 位置吗?')) {
        console.log('Homing motor...');
        startPositionSimulation(0);
        pubsub.publish('motor/home', '');
    }
} function updateButtonStates() {
    elements.btnStartScan.disabled = !state.isConnected || !state.isCalibrated || state.systemState !== 'IDLE';
    elements.btnCalibrateMotor.disabled = !state.isConnected;
    elements.btnHomeMotor.disabled = !state.isConnected;
}

// --- Scanning Logic ---

async function startScan() {
    if (!state.isCalibrated) return;

    setState('SCANNING');
    state.scanData = [];
    elements.wetSpotsLayer.innerHTML = ''; // Clear previous

    // 1. Move to Home (0)
    console.log("Homing...");
    startPositionSimulation(0); // Start simulation for homing
    pubsub.publish('motor/home', '');

    // Wait for homing (simple timeout for now, ideally listen for status)
    // Better: wait until position is near 0
    await waitForPosition(0, 5000);

    // 2. Turn on Fan (Low)
    pubsub.publish('fan/speed', CONFIG.scanSpeed.toString());

    // 3. Start moving to end
    console.log(`Scanning to ${state.paperLengthMm}mm...`);
    startPositionSimulation(state.paperLengthMm);
    pubsub.publish('motor/moveto', state.paperLengthMm.toString());
}

function recordScanData(pos, humidity) {
    /**
     * 扫描过程数据记录
     * 用于初始湿点分析
     */
    const last = state.scanData[state.scanData.length - 1];
    // 避免重复记录 (移动至少1mm才记录新数据)
    if (!last || Math.abs(last.position - pos) > 1.0) {
        state.scanData.push({
            position: pos,
            humidity: humidity,
            timestamp: Date.now()
        });

        // 实时可视化湿点
        if (humidity > CONFIG.wetThresholdPercent) {
            addWetSpotVisual(pos, humidity);
            // 添加/更新湿度柱状图
            updateHumidityBar(pos, humidity);
        }
    }
}

function recordDryingData(pos, humidity) {
    /**
     * 干燥过程持续记录
     * 用于动态更新湿度分布和判断干燥完成
     */
    const now = Date.now();

    // 更新或追加数据点
    const existingIndex = state.scanData.findIndex(p => Math.abs(p.position - pos) < 1.0);

    if (existingIndex >= 0) {
        // 更新已有位置的湿度 (覆盖旧值,保留最新)
        const oldData = state.scanData[existingIndex];
        state.scanData[existingIndex] = {
            position: pos,
            humidity: humidity,
            timestamp: now,
            previousHumidity: oldData.humidity,
            dryingTime: now - oldData.timestamp // 干燥时长
        };
    } else {
        // 新位置,添加数据点
        state.scanData.push({
            position: pos,
            humidity: humidity,
            timestamp: now
        });
    }

    // 更新湿度柱状图
    updateHumidityBar(pos, humidity);

    // 🎯 快速响应: 每3秒重新分析湿点分布
    // 一旦检测不到湿区,立即完成干燥
    if (!state.lastAnalysisTime || now - state.lastAnalysisTime > 3000) {
        state.lastAnalysisTime = now;
        reAnalyzeWetSpots(); // 内部会自动判断是否完成
    }
} function finishScan() {
    console.log("Scan finished");
    pubsub.publish('fan/speed', '0'); // Stop fan temporarily

    analyzeWetSpots();

    if (state.wetSegments.length > 0) {
        startDrying();
    } else {
        setState('FINISHED');
        alert("No wet spots detected!");
        setState('IDLE');
    }
}

// --- Visualization ---

function addWetSpotVisual(pos, humidity) {
    // Create a visual element
    const spot = document.createElement('div');
    spot.className = 'wet-spot';
    spot.style.top = `${pos * CONFIG.pixelsPerMm}px`;
    spot.style.height = `${10 * CONFIG.pixelsPerMm}px`; // Visual size

    // Opacity based on humidity intensity
    const intensity = Math.min(1.0, (humidity - CONFIG.wetThresholdPercent) / 20);
    spot.style.backgroundColor = `rgba(0, 100, 255, ${0.2 + intensity * 0.5})`;

    spot.innerHTML = `<span class="wet-spot-label">${humidity.toFixed(1)}%</span>`;

    elements.wetSpotsLayer.appendChild(spot);
}

function updateHumidityBar(pos, currentHumidity) {
    /**
     * 更新湿度柱状图
     * 蓝色线表示最高湿度,绿色线表示当前湿度
     */
    const barId = `humidity-bar-${Math.round(pos)}`;
    let bar = document.getElementById(barId);

    if (!bar) {
        // 创建新的柱状图条
        bar = document.createElement('div');
        bar.id = barId;
        bar.className = 'humidity-bar';
        bar.style.top = `${pos * CONFIG.pixelsPerMm}px`;
        bar.dataset.position = pos;
        bar.dataset.maxHumidity = currentHumidity;

        // 创建最高湿度线(蓝色)
        const maxLine = document.createElement('div');
        maxLine.className = 'humidity-max-line';
        maxLine.style.width = `${currentHumidity}%`;

        // 创建当前湿度线(绿色)
        const currentLine = document.createElement('div');
        currentLine.className = 'humidity-current-line';
        currentLine.style.width = `${currentHumidity}%`;

        bar.appendChild(maxLine);
        bar.appendChild(currentLine);
        elements.humidityBars.appendChild(bar);
    } else {
        // 更新已有柱状图
        const maxHumidity = parseFloat(bar.dataset.maxHumidity);
        const newMaxHumidity = Math.max(maxHumidity, currentHumidity);
        bar.dataset.maxHumidity = newMaxHumidity;

        // 更新最高湿度线(蓝色)
        const maxLine = bar.querySelector('.humidity-max-line');
        maxLine.style.width = `${newMaxHumidity}%`;

        // 更新当前湿度线(绿色)
        const currentLine = bar.querySelector('.humidity-current-line');
        currentLine.style.width = `${currentHumidity}%`;

        // 如果已经干燥,改变颜色
        if (currentHumidity <= CONFIG.wetThresholdPercent) {
            currentLine.style.backgroundColor = '#2ecc71'; // 绿色表示干燥
            bar.classList.add('dry');
        } else {
            currentLine.style.backgroundColor = '#27ae60'; // 深绿色表示仍在干燥
            bar.classList.remove('dry');
        }
    }
}

// --- Drying Logic ---

function analyzeWetSpots() {
    /**
     * 智能湿点分析算法 - 考虑传感器响应滞后
     * 
     * 关键特性:
     * 1. 传感器响应滞后: 从低湿→高湿需要时间爬升,反之亦然
     * 2. 单调性保证: 爬升时读数≤真实值,下降时读数≥真实值
     * 3. 扫描快速: 传感器未达到稳定就移动到下一位置
     * 
     * 策略:
     * - 上升趋势: 实际湿度可能更高,需要扩大边界
     * - 下降趋势: 实际湿度可能更低,但仍需谨慎
     * - 局部峰值: 高置信度湿点
     * - 连续干点: 用于分段
     */

    state.wetSegments = [];

    // Sort and prepare data
    const sortedData = state.scanData.sort((a, b) => a.position - b.position);

    if (sortedData.length < 2) {
        console.warn("Insufficient scan data");
        return;
    }

    // 分析趋势和合并区段
    let currentSegment = null;
    let consecutiveDryPoints = 0;

    for (let i = 0; i < sortedData.length; i++) {
        const point = sortedData[i];
        const prevPoint = i > 0 ? sortedData[i - 1] : null;
        const nextPoint = i < sortedData.length - 1 ? sortedData[i + 1] : null;

        // 计算趋势 (delta humidity per mm)
        const trend = prevPoint ?
            (point.humidity - prevPoint.humidity) / Math.max(1, point.position - prevPoint.position) : 0;

        // 判断是否为湿点 (考虑趋势补偿)
        const isRising = trend > 0.3; // 上升趋势 (>0.3%/mm)
        const isFalling = trend < -0.3; // 下降趋势

        // 动态阈值: 上升时降低阈值(因为实际可能更湿),下降时提高阈值
        let effectiveThreshold = CONFIG.wetThresholdPercent;
        if (isRising) {
            // 上升中,读数低于真实,降低阈值以提前捕获
            effectiveThreshold = CONFIG.wetThresholdPercent * 0.7; // 3.5%
        } else if (isFalling && point.humidity > CONFIG.wetThresholdPercent * 1.5) {
            // 下降但仍高湿,读数高于真实,稍提高阈值
            effectiveThreshold = CONFIG.wetThresholdPercent * 1.1; // 5.5%
        }

        const isWet = point.humidity > effectiveThreshold;

        if (isWet) {
            consecutiveDryPoints = 0;

            if (!currentSegment) {
                // 开始新区段
                currentSegment = {
                    start: point.position,
                    end: point.position,
                    points: [point],
                    maxHum: point.humidity,
                    trends: [trend]
                };
            } else {
                const gap = point.position - currentSegment.end;
                const avgHum = currentSegment.points.reduce((sum, p) => sum + p.humidity, 0) / currentSegment.points.length;

                // 动态间隙阈值
                let gapThreshold;
                if (avgHum > 15) {
                    gapThreshold = 20; // 高湿度,大容忍(水扩散范围大)
                } else if (avgHum > 8) {
                    gapThreshold = 12; // 中湿度
                } else {
                    gapThreshold = 8;  // 低湿度,小容忍(可能是噪声)
                }

                // 如果前一段在上升,当前在下降,说明中间可能有峰值
                const lastTrend = currentSegment.trends[currentSegment.trends.length - 1];
                if (lastTrend > 0.2 && trend < -0.2 && gap < 15) {
                    // 峰值区域,强制合并
                    gapThreshold = 15;
                }

                if (gap < gapThreshold) {
                    // 扩展当前区段
                    currentSegment.end = point.position;
                    currentSegment.points.push(point);
                    currentSegment.maxHum = Math.max(currentSegment.maxHum, point.humidity);
                    currentSegment.trends.push(trend);
                } else {
                    // 间隙太大,完成当前区段
                    finalizeSegment(currentSegment);
                    currentSegment = {
                        start: point.position,
                        end: point.position,
                        points: [point],
                        maxHum: point.humidity,
                        trends: [trend]
                    };
                }
            }
        } else {
            // 干点逻辑
            consecutiveDryPoints++;

            // 连续3个干点才真正分段 (避免单点噪声)
            if (currentSegment && consecutiveDryPoints >= 3) {
                finalizeSegment(currentSegment);
                currentSegment = null;
            }
        }
    }

    // 完成最后一个区段
    if (currentSegment) {
        finalizeSegment(currentSegment);
    }

    console.log(`Analyzed ${state.wetSegments.length} wet segments:`, state.wetSegments);

    // 计算全局干燥边界
    if (state.wetSegments.length > 0) {
        state.dryingBounds.min = Math.min(...state.wetSegments.map(s => s.expandedStart));
        state.dryingBounds.max = Math.max(...state.wetSegments.map(s => s.expandedEnd));

        // 确保边界在纸张范围内
        state.dryingBounds.min = Math.max(0, state.dryingBounds.min);
        state.dryingBounds.max = Math.min(state.paperLengthMm, state.dryingBounds.max);

        console.log(`Drying bounds: ${state.dryingBounds.min.toFixed(1)}mm - ${state.dryingBounds.max.toFixed(1)}mm`);
    }
}

/**
 * 完成并优化单个湿区段
 */
function finalizeSegment(segment) {
    const points = segment.points;
    const n = points.length;

    if (n === 0) return;

    // 计算统计信息
    const avgHum = points.reduce((sum, p) => sum + p.humidity, 0) / n;
    const maxHum = segment.maxHum;

    // 计算置信度 (基于采样点数和湿度一致性)
    const humidityVariance = points.reduce((sum, p) => sum + Math.pow(p.humidity - avgHum, 2), 0) / n;
    const confidence = Math.min(1.0, (n / 5) * (1 - Math.min(1, humidityVariance / 50)));

    // 检测趋势特征
    const firstTrend = segment.trends[0] || 0;
    const lastTrend = segment.trends[segment.trends.length - 1] || 0;
    const isStartRising = firstTrend > 0.3;
    const isEndFalling = lastTrend < -0.3;

    // 智能边界扩展
    let startMargin, endMargin;

    // 起始边界: 如果在上升,说明前面可能已经湿了(传感器滞后)
    if (isStartRising) {
        startMargin = 15 + (avgHum - CONFIG.wetThresholdPercent) * 2; // 更大扩展
    } else {
        startMargin = 8 + (avgHum - CONFIG.wetThresholdPercent) * 1.2;
    }

    // 结束边界: 如果在下降,说明后面可能还湿(传感器滞后)
    if (isEndFalling) {
        endMargin = 15 + (avgHum - CONFIG.wetThresholdPercent) * 2; // 更大扩展
    } else {
        endMargin = 8 + (avgHum - CONFIG.wetThresholdPercent) * 1.2;
    }

    // 限制边界扩展范围
    startMargin = Math.min(25, Math.max(5, startMargin));
    endMargin = Math.min(25, Math.max(5, endMargin));

    const wetSegment = {
        start: segment.start,
        end: segment.end,
        expandedStart: segment.start - startMargin,
        expandedEnd: segment.end + endMargin,
        avgHum: avgHum,
        maxHum: maxHum,
        pointCount: n,
        confidence: confidence,
        startTrend: isStartRising ? 'rising' : (firstTrend < -0.3 ? 'falling' : 'stable'),
        endTrend: isEndFalling ? 'falling' : (lastTrend > 0.3 ? 'rising' : 'stable'),
        margins: { start: startMargin, end: endMargin }
    };

    state.wetSegments.push(wetSegment);

    console.log(`Segment: ${segment.start.toFixed(0)}-${segment.end.toFixed(0)}mm, ` +
        `Avg:${avgHum.toFixed(1)}%, Max:${maxHum.toFixed(1)}%, ` +
        `Trend:[${wetSegment.startTrend}→${wetSegment.endTrend}], ` +
        `Margins:[+${startMargin.toFixed(0)}/-${endMargin.toFixed(0)}]`);
}

function reAnalyzeWetSpots() {
    /**
     * 动态重新分析湿点分布
     * 在干燥过程中根据最新数据更新湿区
     */
    console.log('⟳ Re-analyzing wet spots with updated data...');

    const oldSegmentCount = state.wetSegments.length;
    const oldBounds = { ...state.dryingBounds };

    // 重新分析
    analyzeWetSpots();

    const newSegmentCount = state.wetSegments.length;

    // 检查湿区变化
    if (newSegmentCount < oldSegmentCount) {
        console.log(`✓ Wet segments reduced: ${oldSegmentCount} → ${newSegmentCount}`);

        if (newSegmentCount === 0) {
            // 🎯 关键判断: 湿点算法检测不到任何湿区 = 干燥完成
            console.log('✓ No wet segments remaining - Drying complete!');
            finishDrying();
            return;
        } else if (state.dryingBounds.min !== oldBounds.min || state.dryingBounds.max !== oldBounds.max) {
            console.log(`Updated drying bounds: [${oldBounds.min.toFixed(0)}-${oldBounds.max.toFixed(0)}] → [${state.dryingBounds.min.toFixed(0)}-${state.dryingBounds.max.toFixed(0)}]`);
        }
    }

    // 更新可视化 (清除已干燥的湿点标记)
    updateAllWetSpotVisuals();
} function updateAllWetSpotVisuals() {
    /**
     * 根据最新数据更新所有湿点的可视化
     */
    const spots = document.querySelectorAll('.wet-spot');

    spots.forEach(spot => {
        const spotTopPx = parseFloat(spot.style.top);
        const spotPosMm = spotTopPx / CONFIG.pixelsPerMm;

        // 查找该位置的最新湿度数据
        const nearbyData = state.scanData.find(p => Math.abs(p.position - spotPosMm) < 5);

        if (nearbyData) {
            if (nearbyData.humidity <= CONFIG.wetThresholdPercent) {
                // 已干燥,变绿色并降低透明度
                spot.style.opacity = '0.3';
                spot.style.backgroundColor = '#2ecc71';
                spot.querySelector('.wet-spot-label').textContent = `${nearbyData.humidity.toFixed(1)}% ✓`;
            } else {
                // 仍然湿,更新强度
                const intensity = Math.min(1.0, (nearbyData.humidity - CONFIG.wetThresholdPercent) / 20);
                spot.style.opacity = '1';
                spot.style.backgroundColor = `rgba(0, 100, 255, ${0.2 + intensity * 0.5})`;
                spot.querySelector('.wet-spot-label').textContent = `${nearbyData.humidity.toFixed(1)}%`;
            }
        }
    });
}

async function startDrying() {
    setState('DRYING');

    // 1. Move to nearest wet spot (usually the end where we stopped, or start)
    // Since we are at the end (paperLength), let's start from there and go backwards
    state.dryingDirection = -1; // Moving towards 0

    // 2. Turn on Max Power
    pubsub.publish('fan/speed', CONFIG.dryFanSpeed.toString());
    pubsub.publish('heater/power', CONFIG.dryHeaterPower.toString());

    // 3. Start oscillation
    moveToNextDryingPoint();
}

function handleDryingMovement(currentPos) {
    // Check if we reached the target bound
    if (state.dryingDirection === -1 && currentPos <= state.dryingBounds.min + 2) {
        // Reached left bound, switch to right
        state.dryingDirection = 1;
        moveToNextDryingPoint();
    } else if (state.dryingDirection === 1 && currentPos >= state.dryingBounds.max - 2) {
        // Reached right bound, switch to left
        state.dryingDirection = -1;
        moveToNextDryingPoint();
    }
}

function moveToNextDryingPoint() {
    const target = state.dryingDirection === 1 ? state.dryingBounds.max : state.dryingBounds.min;
    console.log(`Drying: Moving to ${target}mm`);
    startPositionSimulation(target);
    pubsub.publish('motor/moveto', target.toString());
}

function checkDryingProgress(pos, currentHumidity) {
    /**
     * 智能干燥进度检查 - 快速响应版本
     * 只要湿点算法检测不到湿区就立即完成
     */

    // 不需要等待,直接检查当前湿区状态
    // 实时判断,无需多次确认
} async function finishDrying() {
    /**
     * 干燥完成
     */
    console.log("✓ Drying completed!");

    // 停止加热和风扇
    pubsub.publish('fan/speed', '0');
    pubsub.publish('heater/power', '0');

    setState('FINISHED');

    // 显示完成提示
    alert('🎉 干燥完成! 所有湿区已处理。');

    // 电机回零
    console.log("Returning motor to home position...");
    startPositionSimulation(0);
    pubsub.publish('motor/home', '');

    // 等待回零完成
    await waitForPosition(0, 5000);

    // 返回空闲状态
    setTimeout(() => {
        setState('IDLE');
    }, 1000);
}

function stopAll() {
    setState('IDLE');
    stopPositionSimulation();
    pubsub.publish('motor/stop', ''); // Assuming stop command exists or just stop sending
    // Actually stepper doesn't have stop, but we can stop sending moveto
    // Ideally we should stop the motor

    pubsub.publish('fan/speed', '0');
    pubsub.publish('heater/power', '0');
}

// --- Helpers ---

function setState(newState) {
    state.systemState = newState;
    elements.systemState.textContent = newState;
    updateButtonStates();

    if (newState === 'SCANNING') {
        elements.systemState.style.color = 'orange';
    } else if (newState === 'DRYING') {
        elements.systemState.style.color = 'red';
    } else if (newState === 'FINISHED') {
        elements.systemState.style.color = 'green';
    } else {
        elements.systemState.style.color = '#007bff';
    }
}

function waitForPosition(targetMm, timeoutMs) {
    return new Promise(resolve => {
        const check = setInterval(() => {
            if (Math.abs(state.currentPositionMm - targetMm) < 2) {
                clearInterval(check);
                resolve();
            }
        }, 100);

        setTimeout(() => {
            clearInterval(check);
            resolve();
        }, timeoutMs);
    });
}

// --- Position Simulation (for smooth visual feedback) ---

function startPositionSimulation(targetMm) {
    // Stop any existing simulation
    stopPositionSimulation();

    state.targetPositionMm = targetMm;
    state.isSimulating = true;

    // Calculate movement parameters
    const startPos = state.simulatedPositionMm;
    const distance = Math.abs(targetMm - startPos);
    const direction = targetMm > startPos ? 1 : -1;

    // Speed: 2 rev/sec * 1.498 mm/rev = ~3 mm/sec
    const speedMmPerSec = CONFIG.motorSpeedRevPerSec * CONFIG.mmPerRevolution;

    // Update interval: 50ms (20 fps for smooth animation)
    const updateIntervalMs = 50;
    const stepMm = (speedMmPerSec * updateIntervalMs) / 1000;

    console.log(`Simulating movement: ${startPos.toFixed(1)}mm → ${targetMm.toFixed(1)}mm (${distance.toFixed(1)}mm at ${speedMmPerSec.toFixed(2)}mm/s)`);

    state.simulationInterval = setInterval(() => {
        if (!state.isSimulating) {
            stopPositionSimulation();
            return;
        }

        // Update simulated position
        const remaining = Math.abs(state.targetPositionMm - state.simulatedPositionMm);

        if (remaining < stepMm) {
            // Reached target
            state.simulatedPositionMm = state.targetPositionMm;
            updatePositionVisuals(state.simulatedPositionMm);
            stopPositionSimulation();
        } else {
            // Continue moving
            state.simulatedPositionMm += stepMm * direction;
            updatePositionVisuals(state.simulatedPositionMm);
        }
    }, updateIntervalMs);
}

function stopPositionSimulation() {
    if (state.simulationInterval) {
        clearInterval(state.simulationInterval);
        state.simulationInterval = null;
    }
    state.isSimulating = false;
}
