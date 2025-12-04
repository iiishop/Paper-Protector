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
        updateConnectionStatus(status);

        // Auto-load modules when connected
        if (status === 'connected') {
            if (!moduleLoader.isModuleLoaded('serial_monitor')) {
                loadSerialMonitor();
            }
            if (!moduleLoader.isModuleLoaded('stepper_debug')) {
                loadStepperDebug();
            }
        }
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
    // Register Serial Monitor module
    moduleLoader.registerModule('serial_monitor', {
        path: 'modules/serial_monitor.html',
        title: '串口监视器'
    });

    // Register Stepper Motor Debug module
    moduleLoader.registerModule('stepper_debug', {
        path: 'modules/stepper_debug.html',
        title: '步进电机调试'
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
