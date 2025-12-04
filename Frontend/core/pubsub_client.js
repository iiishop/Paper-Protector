/**
 * PubSubClient - WebSocket-based Publish/Subscribe client for Arduino communication
 * Manages WebSocket connection, subscriptions, and message routing
 */
class PubSubClient {
    constructor(wsUrl = 'ws://localhost:8000/ws') {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.subscriptions = new Map(); // topic -> Set of callbacks
        this.statusHandlers = [];
        this.serialStatusHandlers = [];
        this.messageHandlers = [];
        this.connected = false;
        this.serialConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectDelay = 30000; // 30 seconds
        this.baseReconnectDelay = 1000; // 1 second
    }

    /**
     * Connect to WebSocket server
     */
    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            console.log('WebSocket already connected or connecting');
            return;
        }

        console.log(`Connecting to ${this.wsUrl}...`);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            this.reconnectAttempts = 0;
            this._notifyStatusChange('connected');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this._handleMessage(message);
            } catch (error) {
                console.error('Failed to parse message:', error);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this._notifyStatusChange('error');
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            this._notifyStatusChange('disconnected');
            this._scheduleReconnect();
        };
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    /**
     * Subscribe to a topic
     * @param {string} topic - Topic to subscribe to
     * @param {function} callback - Callback function(topic, payload)
     */
    subscribe(topic, callback) {
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, new Set());
        }
        this.subscriptions.get(topic).add(callback);
        console.log(`Subscribed to topic: ${topic}`);
    }

    /**
     * Unsubscribe from a topic
     * @param {string} topic - Topic to unsubscribe from
     * @param {function} callback - Specific callback to remove (optional)
     */
    unsubscribe(topic, callback = null) {
        if (!this.subscriptions.has(topic)) {
            return;
        }

        if (callback) {
            this.subscriptions.get(topic).delete(callback);
            if (this.subscriptions.get(topic).size === 0) {
                this.subscriptions.delete(topic);
            }
        } else {
            this.subscriptions.delete(topic);
        }
        console.log(`Unsubscribed from topic: ${topic}`);
    }

    /**
     * Publish a message to a topic
     * @param {string} topic - Topic to publish to
     * @param {string} payload - Message payload
     */
    publish(topic, payload) {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('Cannot publish: WebSocket not connected');
            return false;
        }

        const message = {
            type: 'publish',
            topic: topic,
            payload: String(payload),
            timestamp: Date.now()
        };

        try {
            this.ws.send(JSON.stringify(message));
            console.log(`Published to ${topic}:`, payload);
            return true;
        } catch (error) {
            console.error('Failed to publish message:', error);
            return false;
        }
    }

    /**
     * Register a global message handler
     * @param {function} handler - Handler function(message)
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }

    /**
     * Register a status change handler
     * @param {function} handler - Handler function(status)
     */
    onStatusChange(handler) {
        this.statusHandlers.push(handler);
    }

    /**
     * Register a serial status change handler
     * @param {function} handler - Handler function(status)
     */
    onSerialStatusChange(handler) {
        this.serialStatusHandlers.push(handler);
    }

    /**
     * Handle incoming message
     * @private
     */
    _handleMessage(message) {
        // Handle status messages
        if (message.type === 'status') {
            const isConnected = message.status === 'connected';
            if (this.serialConnected !== isConnected) {
                this.serialConnected = isConnected;
                this._notifySerialStatusChange(message.status);
            }
        }

        // Notify global message handlers
        this.messageHandlers.forEach(handler => {
            try {
                handler(message);
            } catch (error) {
                console.error('Error in message handler:', error);
            }
        });

        // Route to topic subscribers
        if (message.topic && this.subscriptions.has(message.topic)) {
            const callbacks = this.subscriptions.get(message.topic);
            callbacks.forEach(callback => {
                try {
                    callback(message.topic, message.payload);
                } catch (error) {
                    console.error(`Error in callback for topic ${message.topic}:`, error);
                }
            });
        }
    }

    /**
     * Notify status change handlers
     * @private
     */
    _notifyStatusChange(status) {
        this.statusHandlers.forEach(handler => {
            try {
                handler(status);
            } catch (error) {
                console.error('Error in status handler:', error);
            }
        });
    }

    /**
     * Notify serial status change handlers
     * @private
     */
    _notifySerialStatusChange(status) {
        this.serialStatusHandlers.forEach(handler => {
            try {
                handler(status);
            } catch (error) {
                console.error('Error in serial status handler:', error);
            }
        });
    }

    /**
     * Schedule reconnection with exponential backoff
     * @private
     */
    _scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        this._notifyStatusChange('reconnecting');

        setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * Get connection status
     */
    isConnected() {
        return this.connected;
    }
}
