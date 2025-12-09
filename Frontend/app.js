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
            // if (!moduleLoader.isModuleLoaded('moisture_sensor')) {
            //     loadMoistureSensor();
            // }
            if (!moduleLoader.isModuleLoaded('dht_sensor')) {
                loadDHTSensor();
            }
            if (!moduleLoader.isModuleLoaded('heater_control')) {
                loadHeaterControl();
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

    moduleLoader.registerModule('dht_sensor', {
        path: 'modules/dht_sensor.html',
        title: 'DHT22温湿度传感器'
    });

    moduleLoader.registerModule('heater_control', {
        path: 'modules/heater_control.html',
        title: '加热器控制'
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
 * Load DHT Sensor module
 */
async function loadDHTSensor() {
    console.log('Loading DHT Sensor module...');
    const success = await moduleLoader.loadModule('dht_sensor', 'module-container');

    if (success) {
        console.log('DHT Sensor module loaded');
        // Initialize DHT module with pubsub client
        if (typeof window.initializeDHTModule === 'function') {
            window.initializeDHTModule(pubsubClient);
        }
    } else {
        console.error('Failed to load DHT Sensor module');
    }
}

/**
 * Load Heater Control module
 */
async function loadHeaterControl() {
    console.log('Loading Heater Control module...');
    const success = await moduleLoader.loadModule('heater_control', 'module-container');

    if (success) {
        console.log('Heater Control module loaded');
    } else {
        console.error('Failed to load Heater Control module');
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
