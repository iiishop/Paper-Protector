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
    currentTemp: document.getElementById('current-temp'),
    currentHumidity: document.getElementById('current-humidity'),
    currentPosition: document.getElementById('current-position'),
    progressBar: document.getElementById('progress-bar'),
    btnCalibrate: document.getElementById('btn-calibrate-zero'),
    btnResetCal: document.getElementById('btn-reset-calibration'),
    btnStartScan: document.getElementById('btn-start-scan'),
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
        const displayVal = state.zeroHumidity !== null ? (val - state.zeroHumidity) : val;
        elements.currentHumidity.textContent = displayVal.toFixed(1);

        // If scanning, record data
        if (state.systemState === 'SCANNING') {
            recordScanData(state.currentPositionMm, displayVal);
        }

        // If drying, check if dry
        if (state.systemState === 'DRYING') {
            checkDryingProgress(state.currentPositionMm, displayVal);
            // Update visual feedback at current position
            updateWetSpotVisual(state.currentPositionMm, displayVal);
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

function updateButtonStates() {
    elements.btnStartScan.disabled = !state.isConnected || !state.isCalibrated || state.systemState !== 'IDLE';
}

// --- Scanning Logic ---

async function startScan() {
    if (!state.isCalibrated) return;

    setState('SCANNING');
    state.scanData = [];
    elements.wetSpotsLayer.innerHTML = ''; // Clear previous

    // 1. Move to Home (0)
    console.log("Homing...");
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
    // Simple binning or just raw recording
    // We only record if we moved enough since last record to avoid duplicate data
    const last = state.scanData[state.scanData.length - 1];
    if (!last || Math.abs(last.position - pos) > 1.0) {
        state.scanData.push({
            position: pos,
            humidity: humidity,
            timestamp: Date.now()
        });

        // Visualize immediately if wet
        if (humidity > CONFIG.wetThresholdPercent) {
            addWetSpotVisual(pos, humidity);
        }
    }
}

function finishScan() {
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

// --- Drying Logic ---

function analyzeWetSpots() {
    // Merge consecutive wet points into segments
    state.wetSegments = [];
    let currentSegment = null;

    // Sort data by position
    const sortedData = state.scanData.sort((a, b) => a.position - b.position);

    for (const point of sortedData) {
        if (point.humidity > CONFIG.wetThresholdPercent) {
            if (!currentSegment) {
                currentSegment = { start: point.position, end: point.position, maxHum: point.humidity };
            } else {
                // Extend segment if close enough (e.g., within 10mm gap)
                if (point.position - currentSegment.end < 10) {
                    currentSegment.end = point.position;
                    currentSegment.maxHum = Math.max(currentSegment.maxHum, point.humidity);
                } else {
                    state.wetSegments.push(currentSegment);
                    currentSegment = { start: point.position, end: point.position, maxHum: point.humidity };
                }
            }
        }
    }
    if (currentSegment) state.wetSegments.push(currentSegment);

    console.log("Wet segments:", state.wetSegments);

    // Calculate global drying bounds
    if (state.wetSegments.length > 0) {
        state.dryingBounds.min = Math.min(...state.wetSegments.map(s => s.start));
        state.dryingBounds.max = Math.max(...state.wetSegments.map(s => s.end));

        // Add some margin
        state.dryingBounds.min = Math.max(0, state.dryingBounds.min - 10);
        state.dryingBounds.max = Math.min(state.paperLengthMm, state.dryingBounds.max + 10);
    }
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
    // If current humidity is low enough, we might be done with this spot
    // But we need to be sure the WHOLE area is dry.
    // For simplicity: We continue oscillating until the user stops or we implement a re-scan logic.
    // Or: We can check if we are consistently low.

    // Update visual feedback (maybe change color of wet spots to green as they dry?)
    // This is complex without re-scanning.
    // For now, we just keep drying.
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
