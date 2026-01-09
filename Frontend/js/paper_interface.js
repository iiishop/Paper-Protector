/**
 * Paper Protector - Main Interface Logic
 */

// Configuration
const CONFIG = {
    paperWidthMm: 50,
    defaultPaperLengthMm: 50,
    pixelsPerMm: 3, // Scale factor for visualization
    scanSpeed: 128, // Fan speed during scan
    dryFanSpeed: 255,
    dryHeaterPower: 255,
    wetThresholdPercent: 2.0, // Relative humidity above zero to consider "wet"
    scanStepMm: 5, // Resolution of scanning
    motorMaxSpeed: 200, // Assuming some max speed for calculations
    motorSpeedRevPerSec: 2.0, // Motor speed: 2 revolutions per second
    mmPerRevolution: 1.498 // mm per revolution (must match Arduino)
};

// State
const state = {
    isConnected: false,
    isSimulatorMode: false, // 模拟器模式标志
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

    // Humidity Chart
    maxHumidityDetected: 0, // 检测到的最高湿度值
    humidityChartMax: 10, // 图表Y轴最大值（动态调整）

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
    btnSetThreshold: document.getElementById('btn-set-threshold'),
    inputThreshold: document.getElementById('wet-threshold-input'),
    calibrationStatus: document.getElementById('calibration-status'),
    systemState: document.getElementById('system-state'),
    connectionStatus: document.getElementById('connection-status'),
    btnToggleSimulator: document.getElementById('btn-toggle-simulator'),
    connectionMode: document.getElementById('connection-mode'),
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

    // Initialize humidity chart scale with default values
    updateHumidityChartScale();

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
    elements.btnSetThreshold.addEventListener('click', setWetThreshold);
    elements.btnToggleSimulator.addEventListener('click', toggleSimulator);
}

function initPubSub() {
    if (state.isSimulatorMode) {
        // 模拟器模式：直接订阅模拟器
        setupSimulatorSubscriptions();
        state.isConnected = true;
        elements.connectionStatus.className = 'status-indicator connected';
        elements.connectionStatus.textContent = 'Simulator';
        updateButtonStates();
        queryCurrentStatus();
    } else {
        // 真实设备模式：使用WebSocket
        pubsub.onStatusChange((status) => {
            elements.connectionStatus.className = `status-indicator ${status}`;
            elements.connectionStatus.textContent = status;
            state.isConnected = (status === 'connected');
            updateButtonStates();

            // Query current status when connected/reconnected
            if (status === 'connected') {
                setTimeout(() => {
                    queryCurrentStatus();
                }, 500);
            }
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
    }
}

function queryCurrentStatus() {
    /**
     * 查询所有设备的当前状态
     * 在连接和重连后调用
     */
    console.log('Querying current status from devices...');
    if (state.isSimulatorMode) {
        window.paperSimulator.publish('fan/query', '');
        window.paperSimulator.publish('heater/query', '');
    } else {
        pubsub.publish('fan/query', '');
        pubsub.publish('heater/query', '');
    }
}

function toggleSimulator() {
    /**
     * 切换模拟器/真实设备模式
     */
    state.isSimulatorMode = !state.isSimulatorMode;

    if (state.isSimulatorMode) {
        // 切换到模拟器模式
        elements.btnToggleSimulator.textContent = 'Switch to Real Device';
        elements.connectionMode.textContent = 'Simulator';

        // 断开WebSocket
        if (state.isConnected) {
            pubsub.disconnect();
        }

        // 启动模拟器
        window.paperSimulator.start();
        setupSimulatorSubscriptions();
        state.isConnected = true;
        elements.connectionStatus.className = 'status-indicator connected';
        elements.connectionStatus.textContent = 'Simulator';
        updateButtonStates();

        console.log('[UI] Switched to Simulator mode');
    } else {
        // 切换到真实设备模式
        elements.btnToggleSimulator.textContent = 'Switch to Simulator';
        elements.connectionMode.textContent = 'Real Device';

        // 停止模拟器
        window.paperSimulator.stop();
        state.isConnected = false;

        // 重新连接WebSocket
        initPubSub();

        console.log('[UI] Switched to Real Device mode');
    }
}

function setupSimulatorSubscriptions() {
    /**
     * 设置模拟器订阅
     */
    window.paperSimulator.subscribe('dht/temperature', handleTemp);
    window.paperSimulator.subscribe('dht/humidity', handleHumidity);
    window.paperSimulator.subscribe('motor/position', handlePosition);
    window.paperSimulator.subscribe('fan/status', handleFanStatus);
    window.paperSimulator.subscribe('heater/status', handleHeaterStatus);
}

// Override pubsub.publish to route to simulator when in simulator mode
const originalPublish = pubsub.publish.bind(pubsub);
pubsub.publish = function (topic, payload) {
    if (state.isSimulatorMode) {
        window.paperSimulator.publish(topic, payload);
    } else {
        originalPublish(topic, payload);
    }
};

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

    // Update humidity chart
    updateHumidityChartAxis();
}

function updateHumidityChartAxis() {
    /**
     * 同步图表高度到纸张高度
     */
    const chartPlotArea = document.querySelector('.chart-plot-area');
    const rulerMarks = document.querySelector('.ruler-marks');

    if (chartPlotArea && rulerMarks) {
        const heightPx = state.paperLengthMm * CONFIG.pixelsPerMm;
        chartPlotArea.style.height = `${heightPx}px`;
        rulerMarks.style.height = `${heightPx}px`;
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
}

function setWetThreshold() {
    /**
     * 设置湿点检测阈值
     */
    const threshold = parseFloat(elements.inputThreshold.value);
    if (threshold >= 0.5 && threshold <= 10) {
        CONFIG.wetThresholdPercent = threshold;
        console.log(`Wet threshold updated to ${threshold}%`);
        alert(`阈值已更新为 ${threshold}%`);
    } else {
        alert('阈值必须在 0.5% 到 10% 之间');
    }
}

function updateButtonStates() {
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
     * 更新湿度柱状图 - 横向显示
     * 蓝色线表示最高湿度,绿色线表示当前湿度
     * Y轴最大值为检测到的最高湿度（动态调整）
     */
    const barId = `humidity-bar-${Math.round(pos)}`;
    let bar = document.getElementById(barId);

    // 更新全局最高湿度
    if (currentHumidity > state.maxHumidityDetected) {
        state.maxHumidityDetected = currentHumidity;
        updateHumidityChartScale();
    }

    // 计算位置百分比(从顶部开始,纵向定位)
    const posPercent = (pos / state.paperLengthMm) * 100;

    if (!bar) {
        // 创建新的柱状图条
        bar = document.createElement('div');
        bar.id = barId;
        bar.className = 'humidity-bar';
        bar.style.top = `${posPercent}%`;
        bar.dataset.position = pos;
        bar.dataset.maxHumidity = currentHumidity;

        // 创建最高湿度线(蓝色)
        const maxLine = document.createElement('div');
        maxLine.className = 'humidity-max-line';

        // 创建当前湿度线(绿色)
        const currentLine = document.createElement('div');
        currentLine.className = 'humidity-current-line';

        bar.appendChild(maxLine);
        bar.appendChild(currentLine);
        elements.humidityBars.appendChild(bar);
    } else {
        // 更新位置(纸张长度可能变化)
        bar.style.top = `${posPercent}%`;

        // 更新已有柱状图
        const maxHumidity = parseFloat(bar.dataset.maxHumidity);
        const newMaxHumidity = Math.max(maxHumidity, currentHumidity);
        bar.dataset.maxHumidity = newMaxHumidity;
    }

    // 计算相对于图表最大值的百分比
    const maxPercent = (parseFloat(bar.dataset.maxHumidity) / state.humidityChartMax) * 100;
    const currentPercent = (currentHumidity / state.humidityChartMax) * 100;

    // 更新线条宽度（横向柱状图）
    const maxLine = bar.querySelector('.humidity-max-line');
    const currentLine = bar.querySelector('.humidity-current-line');

    maxLine.style.width = `${Math.min(100, maxPercent)}%`;
    currentLine.style.width = `${Math.min(100, currentPercent)}%`;

    // 如果已经干燥,改变颜色
    if (currentHumidity <= CONFIG.wetThresholdPercent) {
        currentLine.style.backgroundColor = '#2ecc71'; // 绿色表示干燥
        bar.classList.add('dry');
    } else {
        currentLine.style.backgroundColor = '#27ae60'; // 深绿色表示仍在干燥
        bar.classList.remove('dry');
    }
}

function updateHumidityChartScale() {
    /**
     * 更新湿度图表的刻度范围
     * 根据检测到的最高湿度动态调整
     */
    // 计算合适的最大值（向上取整到10的倍数，但至少为10）
    const detectedMax = state.maxHumidityDetected;
    const newMax = Math.max(10, Math.ceil(detectedMax / 10) * 10);

    const oldMax = state.humidityChartMax;
    state.humidityChartMax = newMax;

    // 更新X轴标签（每次都更新，保证显示）
    const xAxisContainer = document.getElementById('humidity-x-axis');
    if (xAxisContainer) {
        const labels = xAxisContainer.querySelectorAll('.x-label');
        const step = newMax / 4;
        labels[0].textContent = '0%';
        labels[1].textContent = Math.round(step) + '%';
        labels[2].textContent = Math.round(step * 2) + '%';
        labels[3].textContent = Math.round(step * 3) + '%';
        labels[4].textContent = newMax + '%';
    }

    if (newMax !== oldMax) {

        // 重新计算所有柱状图的高度
        const allBars = document.querySelectorAll('.humidity-bar');
        allBars.forEach(bar => {
            const maxHumidity = parseFloat(bar.dataset.maxHumidity);
            const position = parseFloat(bar.dataset.position);

            // 获取当前湿度（从scanData或dryingStats）
            let currentHumidity = maxHumidity;
            if (state.systemState === 'SCANNING' || state.systemState === 'DRYING') {
                // 尝试从数据中获取最新值
                const dataPoint = state.scanData.find(d => Math.abs(d.position - position) < 1);
                if (dataPoint) currentHumidity = dataPoint.humidity;
            }

            const maxPercent = (maxHumidity / newMax) * 100;
            const currentPercent = (currentHumidity / newMax) * 100;

            const maxLine = bar.querySelector('.humidity-max-line');
            const currentLine = bar.querySelector('.humidity-current-line');

            if (maxLine) maxLine.style.width = `${Math.min(100, maxPercent)}%`;
            if (currentLine) currentLine.style.width = `${Math.min(100, currentPercent)}%`;
        });

        console.log(`[Chart] Scale updated: ${oldMax}% → ${newMax}%`);
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
            effectiveThreshold = CONFIG.wetThresholdPercent * 0.7; // 例如 2% * 0.7 = 1.4%
        } else if (isFalling && point.humidity > CONFIG.wetThresholdPercent * 1.5) {
            // 下降但仍高湿,读数高于真实,稍提高阈值
            effectiveThreshold = CONFIG.wetThresholdPercent * 1.1; // 例如 2% * 1.1 = 2.2%
        }

        // 判断是否为湿点：
        // 1. 必须高于动态阈值 (effectiveThreshold)
        // 2. 同时必须高于绝对最低阈值 (1%)，避免噪声误判
        const absoluteMinThreshold = 1.0;
        const isWet = point.humidity > effectiveThreshold && point.humidity > absoluteMinThreshold;

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
    // 使用扩展边界(expandedStart/End)来确保完全覆盖湿点
    if (state.wetSegments.length > 0) {
        const minExpanded = Math.min(...state.wetSegments.map(s => s.expandedStart));
        const maxExpanded = Math.max(...state.wetSegments.map(s => s.expandedEnd));

        // 确保边界在纸张范围内，但不低于第一个湿点或超过最后一个湿点
        state.dryingBounds.min = Math.max(0, minExpanded);
        state.dryingBounds.max = Math.min(state.paperLengthMm, maxExpanded);

        console.log(`Drying bounds: ${state.dryingBounds.min.toFixed(1)}mm - ${state.dryingBounds.max.toFixed(1)}mm`);
        console.log(`  (First wet spot: ${state.wetSegments[0].start.toFixed(1)}mm, Last: ${state.wetSegments[state.wetSegments.length - 1].end.toFixed(1)}mm)`);
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

    // 计算扩展边界，但限制在合理范围内
    // expandedStart不应该向前扩展超过10mm（避免从0开始干燥）
    const expandedStart = Math.max(segment.start - 10, segment.start - startMargin);
    const expandedEnd = segment.end + endMargin;

    const wetSegment = {
        start: segment.start,
        end: segment.end,
        expandedStart: expandedStart,
        expandedEnd: expandedEnd,
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
     * 🎯 关键判断: 所有湿点标记都被移除 = 干燥完成
     */
    console.log('⟳ Re-analyzing wet spots with updated data...');

    // 1. 更新可视化 (移除已干燥的湿点标记)
    updateAllWetSpotVisuals();

    // 2. 检查是否所有湿点都已移除
    const remainingWetSpots = document.querySelectorAll('.wet-spot').length;
    console.log(`📍 Remaining wet spot markers: ${remainingWetSpots}`);

    if (remainingWetSpots === 0) {
        // 🎯 所有湿点标记都消失了 = 干燥完成
        console.log('✓ All wet spot markers removed - Drying complete!');
        completeDrying(); // 直接完成干燥，不需要最后一遍扫描
        return;
    }

    // 3. 仍有湿点,重新计算干燥边界
    const oldBounds = { ...state.dryingBounds };
    analyzeWetSpots();

    // 检查边界是否变化
    if (state.dryingBounds.min !== oldBounds.min || state.dryingBounds.max !== oldBounds.max) {
        console.log(`✓ Updated drying bounds: [${oldBounds.min.toFixed(0)}-${oldBounds.max.toFixed(0)}] → [${state.dryingBounds.min.toFixed(0)}-${state.dryingBounds.max.toFixed(0)}]`);

        // 🎯 关键：边界缩小后，立即调整电机运动范围
        adjustDryingMovementAfterBoundsChange(oldBounds);
    }
}

function adjustDryingMovementAfterBoundsChange(oldBounds) {
    /**
     * 当干燥边界变化时，调整电机运动
     * 如果当前目标位置超出新边界，立即更新到新边界
     */
    const currentTarget = state.targetPositionMm;
    const currentPos = state.currentPositionMm;
    const isMotorStopped = Math.abs(currentPos - currentTarget) < 0.5;

    // 检查当前位置是否超出新边界
    const posOutsideBounds = currentPos < state.dryingBounds.min || currentPos > state.dryingBounds.max;

    // 如果电机已停止且位置超出边界，强制触发移动
    if (isMotorStopped && posOutsideBounds) {
        console.log(`⚠ Motor stopped at ${currentPos.toFixed(0)}mm outside new bounds [${state.dryingBounds.min.toFixed(0)}-${state.dryingBounds.max.toFixed(0)}], forcing movement...`);

        // 根据当前位置决定移动方向
        if (currentPos < state.dryingBounds.min) {
            // 低于最小边界，向最大边界移动
            state.dryingDirection = 1;
        } else {
            // 高于最大边界，向最小边界移动
            state.dryingDirection = -1;
        }
        moveToNextDryingPoint();
        return;
    }

    // 检查当前目标是否超出新边界
    if (currentTarget < state.dryingBounds.min || currentTarget > state.dryingBounds.max) {
        console.log(`⚠ Current target ${currentTarget.toFixed(0)}mm is outside new bounds, adjusting...`);

        // 确定新的移动方向和目标
        if (state.dryingDirection === -1) {
            // 正在向最小值移动
            if (currentPos > state.dryingBounds.max) {
                // 当前位置已经超出新的最大边界，立即向最大边界移动
                state.dryingDirection = -1;
                moveToNextDryingPoint();
            } else if (currentPos < state.dryingBounds.min) {
                // 当前位置已经低于新的最小边界，反向移动到最大边界
                state.dryingDirection = 1;
                moveToNextDryingPoint();
            } else {
                // 在边界内，继续向最小边界移动
                moveToNextDryingPoint();
            }
        } else {
            // 正在向最大值移动
            if (currentPos < state.dryingBounds.min) {
                // 当前位置已经低于新的最小边界，立即向最小边界移动
                state.dryingDirection = 1;
                moveToNextDryingPoint();
            } else if (currentPos > state.dryingBounds.max) {
                // 当前位置已经超出新的最大边界，反向移动到最小边界
                state.dryingDirection = -1;
                moveToNextDryingPoint();
            } else {
                // 在边界内，继续向最大边界移动
                moveToNextDryingPoint();
            }
        }
    }
} function updateAllWetSpotVisuals() {
    /**
     * 根据最新数据更新所有湿点的可视化
     * 移除已干燥的湿点(红色标记),但保留柱状图
     */
    const spots = document.querySelectorAll('.wet-spot');

    spots.forEach(spot => {
        const spotTopPx = parseFloat(spot.style.top);
        const spotPosMm = spotTopPx / CONFIG.pixelsPerMm;

        // 查找该位置的最新湿度数据
        const nearbyData = state.scanData.find(p => Math.abs(p.position - spotPosMm) < 5);

        if (nearbyData) {
            console.log(`[Visual Update] Spot at ${spotPosMm.toFixed(0)}mm: humidity=${nearbyData.humidity.toFixed(1)}%, threshold=${CONFIG.wetThresholdPercent}%`);

            if (nearbyData.humidity <= CONFIG.wetThresholdPercent) {
                // 已干燥,移除湿点标记(但保留柱状图)
                console.log(`[Visual Update] Removing dry spot at ${spotPosMm.toFixed(0)}mm`);
                spot.remove();
            } else {
                // 仍然湿,更新标签和强度
                const intensity = Math.min(1.0, (nearbyData.humidity - CONFIG.wetThresholdPercent) / 20);
                spot.style.opacity = '1';
                spot.style.backgroundColor = `rgba(0, 100, 255, ${0.2 + intensity * 0.5})`;
                spot.querySelector('.wet-spot-label').textContent = `${nearbyData.humidity.toFixed(1)}%`;
            }
        } else {
            console.warn(`[Visual Update] No nearby data found for spot at ${spotPosMm.toFixed(0)}mm`);
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
    const atMinBound = state.dryingDirection === -1 && currentPos <= state.dryingBounds.min + 2;
    const atMaxBound = state.dryingDirection === 1 && currentPos >= state.dryingBounds.max - 2;

    if (atMinBound) {
        // Reached left bound, switch to right
        console.log(`[Drying] Reached min bound (${state.dryingBounds.min.toFixed(0)}mm), reversing to max (${state.dryingBounds.max.toFixed(0)}mm)`);
        state.dryingDirection = 1;
        moveToNextDryingPoint();
    } else if (atMaxBound) {
        // Reached right bound, switch to left
        console.log(`[Drying] Reached max bound (${state.dryingBounds.max.toFixed(0)}mm), reversing to min (${state.dryingBounds.min.toFixed(0)}mm)`);
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
} async function completeDrying() {
    /**
     * 干燥完成 - 直接回到起始位置
     * 所有湿点已被移除，停止加热和风扇，回到home位置
     */
    console.log("✓ All wet spots removed! Drying completed successfully!");

    // 1. 将所有湿度柱状图的绿色柱子归零
    const allBars = document.querySelectorAll('.humidity-bar');
    allBars.forEach(bar => {
        const currentLine = bar.querySelector('.humidity-current-line');
        if (currentLine) {
            currentLine.style.width = '0%';
            currentLine.style.backgroundColor = '#2ecc71'; // 绿色表示干燥
        }
        bar.classList.add('dry');
    });
    console.log(`✓ Reset ${allBars.length} humidity bars to zero`);

    // 2. 停止加热和风扇
    pubsub.publish('fan/speed', '0');
    pubsub.publish('heater/power', '0');

    // 3. 回到起始点
    console.log("Returning to home position...");
    if (state.simulatedPositionMm !== undefined && state.simulatedPositionMm !== null) {
        startPositionSimulation(0);
    }
    pubsub.publish('motor/home', '');
    await waitForPosition(0, 10000);

    // 4. 设置状态为完成
    setState('FINISHED');

    // 显示完成提示
    console.log("🎉 Drying process completed successfully!");
    alert('Drying completed successfully! Paper is now dry.');

    // 返回空闲状态
    setTimeout(() => {
        setState('IDLE');
    }, 2000);
}

async function finishDrying() {
    /**
     * 干燥完成 - 最后一次确认扫描
     * 从当前位置到末尾,再回到起始点,保持干燥状态
     */
    console.log("✓ All wet spots removed! Starting final drying pass...");

    const currentPos = state.currentPositionMm;
    const paperEnd = CONFIG.paperLengthMm;

    // 🎯 最后一遍: 当前位置 → 末尾 → 起始点,全程干燥

    // 1. 移动到末尾 (保持风扇和加热器开启)
    console.log(`Final pass: ${currentPos.toFixed(0)}mm → ${paperEnd}mm (with drying)`);
    if (state.simulatedPositionMm !== undefined && state.simulatedPositionMm !== null) {
        startPositionSimulation(paperEnd);
    }
    pubsub.publish('motor/moveto', paperEnd.toString());
    await waitForPosition(paperEnd, 15000);

    // 2. 回到起始点 (保持风扇和加热器开启)
    console.log(`Final pass: ${paperEnd}mm → 0mm (with drying)`);
    if (state.simulatedPositionMm !== undefined && state.simulatedPositionMm !== null) {
        startPositionSimulation(0);
    }
    pubsub.publish('motor/home', '');
    await waitForPosition(0, 15000);

    // 3. 停止加热和风扇
    console.log("✓ Final drying pass completed!");
    pubsub.publish('fan/speed', '0');
    pubsub.publish('heater/power', '0');

    setState('FINISHED');

    // 显示完成提示
    alert('Drying completed!');

    // 返回空闲状态
    setTimeout(() => {
        setState('IDLE');
    }, 1000);
}

function stopAll() {
    setState('IDLE');
    stopPositionSimulation();

    // 注意：步进电机使用阻塞式执行，无法中途停止
    // 在模拟器模式下可以停止，但真实设备必须等待当前移动完成
    if (state.isSimulatorMode) {
        pubsub.publish('motor/stop', '');
    } else {
        // 真实设备：停止发送新的移动命令即可
        // 当前正在执行的移动会完成
        console.log('[StopAll] Motor will stop after current movement completes');
    }

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
        let resolved = false;
        const check = setInterval(() => {
            if (Math.abs(state.currentPositionMm - targetMm) < 2) {
                clearInterval(check);
                resolved = true;
                console.log(`✓ Position reached: ${state.currentPositionMm}mm (target: ${targetMm}mm)`);
                resolve(true);
            }
        }, 100);

        setTimeout(() => {
            clearInterval(check);
            if (!resolved) {
                console.warn(`⚠ Position wait timeout after ${timeoutMs}ms. Current: ${state.currentPositionMm}mm, Target: ${targetMm}mm`);
                resolve(false);
            }
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
    // Ensure simulatedPositionMm has a valid value (default to currentPositionMm or 0)
    if (state.simulatedPositionMm === undefined || state.simulatedPositionMm === null) {
        state.simulatedPositionMm = state.currentPositionMm || 0;
    }
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
