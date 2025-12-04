/**
 * ModuleLoader - Dynamic module loading and lifecycle management
 * Loads HTML modules, manages their lifecycle, and provides shared resources
 */
class ModuleLoader {
    constructor(pubsubClient) {
        this.pubsubClient = pubsubClient;
        this.loadedModules = new Map(); // moduleName -> module info
        this.moduleRegistry = new Map(); // moduleName -> config
    }

    /**
     * Register a module configuration
     * @param {string} name - Module name
     * @param {object} config - Module configuration
     */
    registerModule(name, config) {
        this.moduleRegistry.set(name, {
            name: name,
            path: config.path || `modules/${name}.html`,
            title: config.title || name,
            ...config
        });
        console.log(`Registered module: ${name}`);
    }

    /**
     * Load a module into a container
     * @param {string} moduleName - Name of the module to load
     * @param {string} containerId - ID of the container element
     * @returns {Promise<boolean>} - Success status
     */
    async loadModule(moduleName, containerId = 'module-container') {
        if (this.loadedModules.has(moduleName)) {
            console.warn(`Module ${moduleName} is already loaded`);
            return false;
        }

        const config = this.moduleRegistry.get(moduleName);
        if (!config) {
            console.error(`Module ${moduleName} is not registered`);
            return false;
        }

        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container ${containerId} not found`);
            return false;
        }

        try {
            console.log(`Loading module: ${moduleName} from ${config.path}`);

            // Fetch module HTML
            const response = await fetch(config.path);
            if (!response.ok) {
                throw new Error(`Failed to fetch module: ${response.statusText}`);
            }

            const html = await response.text();

            // Create module wrapper
            const moduleWrapper = document.createElement('div');
            moduleWrapper.id = `module-${moduleName}`;
            moduleWrapper.className = 'module-wrapper';

            // Parse HTML to extract scripts
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Extract and execute scripts separately
            const scripts = tempDiv.querySelectorAll('script');
            const scriptContents = [];
            scripts.forEach(script => {
                scriptContents.push(script.textContent);
                script.remove(); // Remove from temp div
            });

            // Set the HTML without scripts
            moduleWrapper.innerHTML = tempDiv.innerHTML;

            // Clear container and add module
            container.innerHTML = '';
            container.appendChild(moduleWrapper);

            // Execute scripts in order
            scriptContents.forEach(scriptContent => {
                try {
                    const scriptElement = document.createElement('script');
                    scriptElement.textContent = scriptContent;
                    document.body.appendChild(scriptElement);
                } catch (error) {
                    console.error('Error executing module script:', error);
                }
            });

            // Store module info
            const moduleInfo = {
                name: moduleName,
                config: config,
                wrapper: moduleWrapper,
                container: container,
                loadedAt: Date.now()
            };
            this.loadedModules.set(moduleName, moduleInfo);

            // Initialize module if it has an init function
            await this._initializeModule(moduleName, moduleWrapper);

            console.log(`Module ${moduleName} loaded successfully`);
            return true;

        } catch (error) {
            console.error(`Failed to load module ${moduleName}:`, error);
            return false;
        }
    }

    /**
     * Unload a module
     * @param {string} moduleName - Name of the module to unload
     * @returns {boolean} - Success status
     */
    unloadModule(moduleName) {
        const moduleInfo = this.loadedModules.get(moduleName);
        if (!moduleInfo) {
            console.warn(`Module ${moduleName} is not loaded`);
            return false;
        }

        try {
            console.log(`Unloading module: ${moduleName}`);

            // Call module's cleanup function if it exists
            this._cleanupModule(moduleName, moduleInfo.wrapper);

            // Remove DOM elements
            if (moduleInfo.wrapper && moduleInfo.wrapper.parentNode) {
                moduleInfo.wrapper.parentNode.removeChild(moduleInfo.wrapper);
            }

            // Remove from loaded modules
            this.loadedModules.delete(moduleName);

            console.log(`Module ${moduleName} unloaded successfully`);
            return true;

        } catch (error) {
            console.error(`Failed to unload module ${moduleName}:`, error);
            return false;
        }
    }

    /**
     * Get list of loaded modules
     * @returns {Array<string>} - Array of loaded module names
     */
    getLoadedModules() {
        return Array.from(this.loadedModules.keys());
    }

    /**
     * Check if a module is loaded
     * @param {string} moduleName - Module name to check
     * @returns {boolean} - True if loaded
     */
    isModuleLoaded(moduleName) {
        return this.loadedModules.has(moduleName);
    }

    /**
     * Get registered modules
     * @returns {Array<object>} - Array of registered module configs
     */
    getRegisteredModules() {
        return Array.from(this.moduleRegistry.values());
    }

    /**
     * Initialize module with shared resources
     * @private
     */
    async _initializeModule(moduleName, wrapper) {
        // Look for module initialization function
        const initFunctionName = `init_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;

        console.log(`Looking for init function: ${initFunctionName}`);
        console.log(`Function exists:`, typeof window[initFunctionName]);

        if (typeof window[initFunctionName] === 'function') {
            try {
                console.log(`Initializing module ${moduleName} with function ${initFunctionName}`);
                await window[initFunctionName](this.pubsubClient);
            } catch (error) {
                console.error(`Error initializing module ${moduleName}:`, error);
            }
        }

        // Dispatch custom event for module load
        const event = new CustomEvent('moduleLoaded', {
            detail: {
                moduleName: moduleName,
                pubsubClient: this.pubsubClient
            }
        });
        wrapper.dispatchEvent(event);
    }

    /**
     * Cleanup module resources
     * @private
     */
    _cleanupModule(moduleName, wrapper) {
        // Look for module cleanup function
        const cleanupFunctionName = `cleanup_${moduleName.replace(/[^a-zA-Z0-9]/g, '_')}`;

        if (typeof window[cleanupFunctionName] === 'function') {
            try {
                console.log(`Cleaning up module ${moduleName} with function ${cleanupFunctionName}`);
                window[cleanupFunctionName]();
            } catch (error) {
                console.error(`Error cleaning up module ${moduleName}:`, error);
            }
        }

        // Dispatch custom event for module unload
        const event = new CustomEvent('moduleUnloaded', {
            detail: { moduleName: moduleName }
        });
        wrapper.dispatchEvent(event);
    }
}
