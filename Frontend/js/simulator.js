/**
 * Paper Protector - Simulator
 * 模拟传感器数据和电机行为用于测试
 */

class PaperProtectorSimulator {
    constructor() {
        this.isRunning = false;
        this.currentPosition = 0; // mm
        this.currentTemperature = 22.5;
        this.baseHumidity = 45.0;
        this.fanSpeed = 0;
        this.heaterPower = 0;
        this.motorMoving = false;
        this.targetPosition = 0;

        // 模拟湿点数据 (位置mm, 湿度增量%)
        this.wetSpots = [
            { position: 15, humidity: 8 },
            { position: 28, humidity: 12 },
            { position: 42, humidity: 6 }
        ];

        this.updateInterval = null;
        this.positionInterval = null;
        this.subscriptions = new Map();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[Simulator] Started');

        // 模拟传感器数据更新 (200ms)
        this.updateInterval = setInterval(() => {
            this.updateSensorData();
        }, 200);

        // 模拟电机位置更新 (100ms)
        this.positionInterval = setInterval(() => {
            this.updateMotorPosition();
        }, 100);
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        console.log('[Simulator] Stopped');

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.positionInterval) {
            clearInterval(this.positionInterval);
            this.positionInterval = null;
        }
    }

    subscribe(topic, callback) {
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, []);
        }
        this.subscriptions.get(topic).push(callback);
        console.log(`[Simulator] Subscribed to ${topic}`);
    }

    publish(topic, payload) {
        console.log(`[Simulator] Received: ${topic} = ${payload}`);

        // 处理命令
        switch (topic) {
            case 'fan/speed':
                this.fanSpeed = parseInt(payload);
                this.notify('fan/status', this.fanSpeed.toString());
                break;

            case 'heater/power':
                this.heaterPower = parseInt(payload);
                this.notify('heater/status', this.heaterPower.toString());
                break;

            case 'motor/moveto':
                this.targetPosition = parseFloat(payload);
                this.motorMoving = true;
                console.log(`[Simulator] Motor moving to ${this.targetPosition}mm`);
                break;

            case 'motor/home':
                this.targetPosition = 0;
                this.motorMoving = true;
                console.log('[Simulator] Motor homing');
                break;

            case 'motor/calibrate':
                this.currentPosition = 0;
                this.notify('motor/position', '0,0');
                console.log('[Simulator] Motor calibrated to 0');
                break;

            case 'motor/stop':
                // 停止电机移动
                this.motorMoving = false;
                this.targetPosition = this.currentPosition; // 停在当前位置
                console.log('[Simulator] Motor stopped at current position');
                break;

            case 'fan/query':
                this.notify('fan/status', this.fanSpeed.toString());
                break;

            case 'heater/query':
                this.notify('heater/status', this.heaterPower.toString());
                break;
        }
    }

    notify(topic, payload) {
        if (this.subscriptions.has(topic)) {
            this.subscriptions.get(topic).forEach(callback => {
                callback(topic, payload);
            });
        }
    }

    updateSensorData() {
        if (!this.isRunning) return;

        // 模拟温度波动
        const tempNoise = (Math.random() - 0.5) * 0.2;
        this.currentTemperature = 22.5 + tempNoise;

        // 根据加热器调整温度
        if (this.heaterPower > 0) {
            this.currentTemperature += this.heaterPower / 255 * 5;
        }

        // 模拟湿点随时间干燥（当有风扇/加热器工作时）
        if (this.fanSpeed > 0 || this.heaterPower > 0) {
            for (let i = 0; i < this.wetSpots.length; i++) {
                const spot = this.wetSpots[i];
                const distance = Math.abs(this.currentPosition - spot.position);

                // 干燥效果随距离衰减：15mm内都有干燥效果
                if (distance < 15 && spot.humidity > 0) {
                    // 基础干燥速率
                    const baseDryingRate = (this.fanSpeed / 255 * 0.15) + (this.heaterPower / 255 * 0.2);

                    // 每20次干燥尝试输出一次调试信息
                    if (!this.dryingDebugCounter) this.dryingDebugCounter = 0;
                    this.dryingDebugCounter++;
                    if (this.dryingDebugCounter % 20 === 0) {
                        console.log(`[Simulator] Drying attempt: Spot ${i} at ${spot.position}mm, current pos: ${this.currentPosition.toFixed(1)}mm, distance: ${distance.toFixed(1)}mm, humidity: ${spot.humidity.toFixed(2)}%, fan: ${this.fanSpeed}, heater: ${this.heaterPower}`);
                    }

                    // 距离衰减系数：0mm时100%效果，15mm时0%效果
                    const distanceFactor = Math.max(0, 1 - (distance / 15));

                    // 实际干燥速率 = 基础速率 × 距离系数
                    const dryingRate = baseDryingRate * distanceFactor;

                    const oldHumidity = spot.humidity;
                    const newHumidity = Math.max(0, spot.humidity - dryingRate);

                    // 检测异常跳变（上升超过1%）
                    if (newHumidity > oldHumidity + 1) {
                        console.error(`[Simulator] ⚠️ ANOMALY! Spot ${i} at ${spot.position}mm jumped UP: ${oldHumidity.toFixed(2)}% → ${newHumidity.toFixed(2)}%`);
                        console.error(`[Simulator] Spot object:`, spot);
                        console.error(`[Simulator] All spots:`, this.wetSpots);
                    }

                    spot.humidity = newHumidity;

                    // 调试：记录所有湿点变化
                    if (Math.abs(oldHumidity - spot.humidity) > 0.01) {
                        console.log(`[Simulator] Spot ${i} at ${spot.position}mm: ${oldHumidity.toFixed(2)}% → ${spot.humidity.toFixed(2)}% (pos: ${this.currentPosition.toFixed(1)}mm, dist: ${distance.toFixed(1)}mm, factor: ${distanceFactor.toFixed(2)})`);
                    }
                }
            }
        }

        // 计算当前位置的湿度
        // 基线湿度 + 湿点增量
        let humidity = this.baseHumidity;

        // 检查是否在湿点附近（无高斯衰减，直接使用湿点值）
        for (const spot of this.wetSpots) {
            const distance = Math.abs(this.currentPosition - spot.position);
            if (distance < 5) {
                // 直接使用湿点的湿度值作为增量
                humidity = this.baseHumidity + spot.humidity;
                break; // 只取最近的一个湿点
            }
        }

        // 限制在合理范围内
        humidity = Math.max(0, Math.min(100, humidity));

        // 发送数据
        this.notify('dht/temperature', this.currentTemperature.toFixed(1));
        this.notify('dht/humidity', humidity.toFixed(1));
    }

    updateMotorPosition() {
        if (!this.isRunning || !this.motorMoving) return;

        const diff = this.targetPosition - this.currentPosition;

        // 当非常接近目标时，直接到达（避免抖动）
        if (Math.abs(diff) < 0.5) {
            this.currentPosition = this.targetPosition;
            this.motorMoving = false;
            console.log(`[Simulator] Motor reached ${this.currentPosition}mm`);
        } else {
            // 根据距离调整速度（接近时减速）
            let speed = 0.3; // mm per 100ms (2 rev/sec * 1.498 mm/rev ≈ 3mm/s)

            // 当距离小于5mm时减速，避免过冲
            if (Math.abs(diff) < 5) {
                speed = Math.max(0.05, Math.abs(diff) / 2);
            }

            const direction = diff > 0 ? 1 : -1;
            const step = Math.min(speed, Math.abs(diff)); // 不超过剩余距离
            this.currentPosition += step * direction;
        }

        // 发送位置 (格式: revolutions,mm)
        const revolutions = this.currentPosition / 1.498;
        this.notify('motor/position', `${revolutions.toFixed(2)},${this.currentPosition.toFixed(1)}`);
    }

    // 模拟干燥过程中湿度降低
    simulateDrying(position, duration = 5000) {
        // 找到该位置的湿点
        for (const spot of this.wetSpots) {
            if (Math.abs(spot.position - position) < 5) {
                const initialHumidity = spot.humidity;
                const startTime = Date.now();

                const dryInterval = setInterval(() => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(1, elapsed / duration);
                    spot.humidity = initialHumidity * (1 - progress);

                    if (progress >= 1) {
                        clearInterval(dryInterval);
                        console.log(`[Simulator] Spot at ${position}mm dried`);
                    }
                }, 100);
            }
        }
    }

    reset() {
        this.currentPosition = 0;
        this.currentTemperature = 22.5;
        this.fanSpeed = 0;
        this.heaterPower = 0;
        this.motorMoving = false;
        this.targetPosition = 0;

        // 重置湿点
        this.wetSpots = [
            { position: 15, humidity: 8 },
            { position: 28, humidity: 12 },
            { position: 42, humidity: 6 }
        ];

        console.log('[Simulator] Reset');
    }
}

// 全局模拟器实例
window.paperSimulator = new PaperProtectorSimulator();
