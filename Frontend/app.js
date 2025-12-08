/**
 * Main Application Initialization
 * Initializes PubSubClient, ModuleLoader, and UI event handlers
 */

// Global instances
let pubsubClient;
let moduleLoader;

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Arduino Serial PubSub Dashboard...');

    // Initialize PubSubClient
    const wsUrl = 'ws://localhost:8000/ws';
    pubsubClient = new PubSubClient(wsUrl);

    // Initialize ModuleLoader
    moduleLoader = new ModuleLoader(pubsubClient);

    // Register modules
    registerModules();

    // Register status change handler
    pubsubClient.onStatusChange((status) => {
        // Only update UI for non-connected states from WS (like error/disconnected)
        // Connected state will be handled by Serial status
        if (status !== 'connected') {
            updateConnectionStatus(status);
        }

        if (status === 'connected') {
            // Load all modules simultaneously
            if (!moduleLoader.isModuleLoaded('serial_monitor')) {
                loadSerialMonitor();
            }
            if (!moduleLoader.isModuleLoaded('stepper_debug')) {
                loadStepperDebug();
            }
            if (!moduleLoader.isModuleLoaded('fan_control')) {
                loadFanControl();
            }
            if (!moduleLoader.isModuleLoaded('moisture_sensor')) {
                loadMoistureSensor();
            }
            if (!moduleLoader.isModuleLoaded('irled_control')) {
                loadIRLEDControl();
            }
            if (!moduleLoader.isModuleLoaded('sensor_led_control')) {
                loadSensorLEDControl();
            }
        }
    });

    // Register Serial status change handler
    pubsubClient.onSerialStatusChange((status) => {
        updateConnectionStatus(status);
    });

    // Connect to WebSocket
    pubsubClient.connect();

    // Make instances globally available for modules
    window.pubsubClient = pubsubClient;
    window.moduleLoader = moduleLoader;

    console.log('Dashboard initialized successfully');
});

/**
 * Register available modules
 */
function registerModules() {
    moduleLoader.registerModule('serial_monitor', {
        path: 'modules/serial_monitor.html',
        title: '串口监视器'
    });

    moduleLoader.registerModule('stepper_debug', {
        path: 'modules/stepper_debug.html',
        title: '步进电机调试'
    });

    moduleLoader.registerModule('fan_control', {
        path: 'modules/fan_control.html',
        title: '风扇控制'
    });

    moduleLoader.registerModule('moisture_sensor', {
        path: 'modules/moisture_sensor.html',
        title: '湿度传感器'
    });

    moduleLoader.registerModule('irled_control', {
        path: 'modules/irled_control.html',
        title: 'IR LED 控制'
    });

    moduleLoader.registerModule('sensor_led_control', {
        path: 'modules/sensor_led_control.html',
        title: '传感器板载LED'
    });

    console.log('Modules registered');
}

/**
 * Load Serial Monitor module
 */
async function loadSerialMonitor() {
    console.log('Loading Serial Monitor module...');
    const success = await moduleLoader.loadModule('serial_monitor', 'module-container');

    if (success) {
        console.log('Serial Monitor module loaded');
    } else {
        console.error('Failed to load Serial Monitor module');
    }
}

/**
 * Load Stepper Debug module
 */
async function loadStepperDebug() {
    console.log('Loading Stepper Debug module...');
    const success = await moduleLoader.loadModule('stepper_debug', 'module-container');

    if (success) {
        console.log('Stepper Debug module loaded');
    } else {
        console.error('Failed to load Stepper Debug module');
    }
}

async function loadFanControl() {
    console.log('Loading Fan Control module...');
    const success = await moduleLoader.loadModule('fan_control', 'module-container');

    if (success) {
        console.log('Fan Control module loaded');
    } else {
        console.error('Failed to load Fan Control module');
    }
}

/**
 * Load Moisture Sensor module
 */
async function loadMoistureSensor() {
    console.log('Loading Moisture Sensor module...');
    const success = await moduleLoader.loadModule('moisture_sensor', 'module-container');

    if (success) {
        console.log('Moisture Sensor module loaded');
    } else {
        console.error('Failed to load Moisture Sensor module');
    }
}

/**
 * Load IR LED Control module
 */
async function loadIRLEDControl() {
    console.log('Loading IR LED Control module...');
    const success = await moduleLoader.loadModule('irled_control', 'module-container');

    if (success) {
        console.log('IR LED Control module loaded');
    } else {
        console.error('Failed to load IR LED Control module');
    }
}

/**
 * Load Sensor LED Control module
 */
async function loadSensorLEDControl() {
    console.log('Loading Sensor LED Control module...');
    const success = await moduleLoader.loadModule('sensor_led_control', 'module-container');

    if (success) {
        console.log('Sensor LED Control module loaded');
    } else {
        console.error('Failed to load Sensor LED Control module');
    }
}

/**
 * Update connection status indicator in UI
 */
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    if (!statusElement) return;

    // Remove all status classes
    statusElement.classList.remove('connected', 'disconnected', 'reconnecting');

    // Add appropriate class and text
    switch (status) {
        case 'connected':
            statusElement.classList.add('connected');
            statusElement.textContent = '已连接';
            break;
        case 'disconnected':
            statusElement.classList.add('disconnected');
            statusElement.textContent = '断开';
            break;
        case 'reconnecting':
            statusElement.classList.add('reconnecting');
            statusElement.textContent = '重连中...';
            break;
        case 'error':
            statusElement.classList.add('disconnected');
            statusElement.textContent = '错误';
            break;
        default:
            statusElement.classList.add('disconnected');
            statusElement.textContent = '未知';
    }
}
