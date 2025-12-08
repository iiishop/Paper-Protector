#include "MoistureSensor.h"

// 静态成员初始化
MoistureSensor *MoistureSensor::_instance = nullptr;

MoistureSensor::MoistureSensor(SerialPubSub *pubsub, int irledPin)
    : _pubsub(pubsub),
      _irledPin(irledPin),
      _irledState(false),
      _lastMeasurementTime(0),
      _gain(AS7341_GAIN_128X),
      _integrationTime(100)
{

    // 初始化校准数据
    _calibration.dryBaseline = 0.0;
    _calibration.wetBaseline = 0.0;
    _calibration.timestamp = 0;
    _calibration.isValid = false;

    // 设置静态实例指针
    _instance = this;
}

bool MoistureSensor::begin()
{
    // 配置IRLED引脚为输出模式
    pinMode(_irledPin, OUTPUT);
    setIRLED(false); // 初始状态关闭

    // 订阅 IR LED 控制主题(独立于传感器,总是可用)
    _pubsub->subscribe("irled/control", irledControlCallback);
    _pubsub->subscribe("irled/get", irledGetCallback);

    // 发布初始 LED 状态
    _pubsub->publish("irled/status", "off");

    // 初始化AS7341传感器
    if (!_sensor.begin())
    {
        publishError("AS7341 sensor not found");
        _pubsub->publish("moisture/status", "sensor_error");
        // 即使传感器失败,IR LED 控制仍然可用
        return false;
    }

    // 配置传感器参数
    _sensor.setGain(_gain);
    _sensor.setATIME(_integrationTime);

    // 订阅湿度传感器相关主题
    _pubsub->subscribe("moisture/measure", measureCallback);
    _pubsub->subscribe("moisture/calibrate", calibrateCallback);
    _pubsub->subscribe("moisture/config", configCallback);

    // 发布初始化成功消息
    _pubsub->publish("moisture/status", "ready");

    return true;
}

void MoistureSensor::loop()
{
    // 处理SerialPubSub消息
    // SerialPubSub的loop()方法在主程序中调用，这里不需要重复调用
    // 此方法保留用于未来的异步处理逻辑

    // 当前实现：所有消息处理通过回调函数完成
    // 测量频率限制在measure()方法中实现
    // 传感器饱和处理在measure()方法中实现
}

MoistureSensor::MeasurementResult MoistureSensor::measure()
{
    MeasurementResult result = {false, 0.0, false};

    // 检查测量频率限制（最小间隔500ms）
    unsigned long currentTime = millis();
    if (currentTime - _lastMeasurementTime < MIN_MEASUREMENT_INTERVAL)
    {
        publishError("Measurement too frequent");
        return result;
    }
    _lastMeasurementTime = currentTime;

    // 重试机制（最多3次）
    for (int retry = 0; retry < MAX_RETRIES; retry++)
    {
        uint16_t readings[12];

        // 步骤1: 测量环境光强度（IRLED关闭）
        setIRLED(false);

        if (!_sensor.readAllChannels(readings))
        {
            // 读取失败，重试
            if (retry < MAX_RETRIES - 1)
            {
                delay(RETRY_DELAY_MS);
            }
            continue;
        }

        // 检查环境光是否饱和
        if (handleSaturation(readings))
        {
            // 增益已调整，重新测量
            if (retry < MAX_RETRIES - 1)
            {
                delay(RETRY_DELAY_MS);
            }
            continue;
        }

        float ambientIntensity = readings[AS7341_CHANNEL_NIR];

        // 步骤2: 打开IRLED并测量总光强度
        setIRLED(true);

        if (!_sensor.readAllChannels(readings))
        {
            setIRLED(false); // 确保关闭LED
            // 读取失败，重试
            if (retry < MAX_RETRIES - 1)
            {
                delay(RETRY_DELAY_MS);
            }
            continue;
        }

        // 检查反射光是否饱和
        if (handleSaturation(readings))
        {
            setIRLED(false); // 确保关闭LED
            // 增益已调整，重新测量
            if (retry < MAX_RETRIES - 1)
            {
                delay(RETRY_DELAY_MS);
            }
            continue;
        }

        float totalIntensity = readings[AS7341_CHANNEL_NIR];

        // 步骤3: 测量完成后关闭IRLED
        setIRLED(false);

        // 步骤4: 计算净反射光强度
        float reflectedIntensity = totalIntensity - ambientIntensity;
        if (reflectedIntensity < 0)
        {
            reflectedIntensity = 0;
        }

        // 测量成功，检测纸张存在性
        result.paperPresent = detectPaper(reflectedIntensity, ambientIntensity);
        result.isValid = true;

        // 如果有纸张，调用calculateMoisture()计算湿度
        if (result.paperPresent)
        {
            result.moisturePercent = calculateMoisture(reflectedIntensity);
        }
        else
        {
            result.moisturePercent = 0.0;
        }

        // 返回MeasurementResult结构体
        return result;
    }

    // 所有重试失败
    publishError("Sensor communication failed after retries");
    return result;
}

float MoistureSensor::readAmbientIntensity()
{
    uint16_t readings[12];

    // 确保IRLED关闭
    setIRLED(false);

    if (!_sensor.readAllChannels(readings))
    {
        return -1.0; // 读取失败
    }

    // 返回NIR通道的环境光强度
    return readings[AS7341_CHANNEL_NIR];
}

float MoistureSensor::readNIRIntensity()
{
    uint16_t readings[12];

    // 步骤1: 测量环境光强度（IRLED关闭）
    setIRLED(false);

    if (!_sensor.readAllChannels(readings))
    {
        return -1.0; // 读取失败
    }

    // 获取NIR通道的环境光强度
    float ambientIntensity = readings[AS7341_CHANNEL_NIR];

    // 步骤2: 打开IRLED并测量总光强度
    setIRLED(true);

    if (!_sensor.readAllChannels(readings))
    {
        setIRLED(false); // 确保关闭LED
        return -1.0;     // 读取失败
    }

    // 获取NIR通道的总光强度
    float totalIntensity = readings[AS7341_CHANNEL_NIR];

    // 步骤3: 测量完成后关闭IRLED
    setIRLED(false);

    // 步骤4: 计算净反射光强度（总光强度 - 环境光）
    float reflectedIntensity = totalIntensity - ambientIntensity;

    // 确保返回值非负
    if (reflectedIntensity < 0)
    {
        reflectedIntensity = 0;
    }

    return reflectedIntensity;
}

bool MoistureSensor::detectPaper(float intensity, float ambient)
{
    // 纸张检测阈值：反射光强度 > 环境光 * 1.5
    // 这确保反射光明显高于环境光，表示有纸张存在
    const float PAPER_DETECTION_THRESHOLD = 1.5;

    return intensity > (ambient * PAPER_DETECTION_THRESHOLD);
}

float MoistureSensor::calculateMoisture(float intensity)
{
    float moisture = 0.0;

    // 检查校准数据是否有效
    if (_calibration.isValid && _calibration.dryBaseline > _calibration.wetBaseline)
    {
        // 使用校准的线性插值模型
        // moisture% = 100 * (I_dry - I_reflected) / (I_dry - I_wet)
        float numerator = _calibration.dryBaseline - intensity;
        float denominator = _calibration.dryBaseline - _calibration.wetBaseline;

        // 避免除以零
        if (denominator > 0.1)
        {
            moisture = 100.0 * numerator / denominator;
        }
        else
        {
            // 校准数据无效（干湿基准太接近）
            moisture = 0.0;
        }
    }
    else
    {
        // 未校准情况：使用默认映射
        // 假设典型的NIR反射范围：干燥纸张 ~1000-2000，湿润纸张 ~200-500
        // 使用简单的线性映射作为默认值
        const float DEFAULT_DRY_BASELINE = 1500.0;
        const float DEFAULT_WET_BASELINE = 300.0;

        float numerator = DEFAULT_DRY_BASELINE - intensity;
        float denominator = DEFAULT_DRY_BASELINE - DEFAULT_WET_BASELINE;

        moisture = 100.0 * numerator / denominator;
    }

    // 确保返回值在[0, 100]范围内
    if (moisture < 0.0)
    {
        moisture = 0.0;
    }
    else if (moisture > 100.0)
    {
        moisture = 100.0;
    }

    return moisture;
}

bool MoistureSensor::calibrateDry()
{
    // 测量干燥纸张基准
    float intensity = readNIRIntensity();

    // 检查测量是否成功
    if (intensity < 0)
    {
        publishError("Failed to read NIR intensity during dry calibration");
        return false;
    }

    // 存储干燥基准到成员变量
    _calibration.dryBaseline = intensity;
    _calibration.timestamp = millis();

    // 如果湿润基准也已设置，标记校准数据为有效
    if (_calibration.wetBaseline > 0)
    {
        _calibration.isValid = true;
    }

    // 通过SerialPubSub发布校准结果消息
    publishCalibration("dry", _calibration.dryBaseline, true);

    return true;
}

bool MoistureSensor::calibrateWet()
{
    // 测量湿润纸张基准
    float intensity = readNIRIntensity();

    // 检查测量是否成功
    if (intensity < 0)
    {
        publishError("Failed to read NIR intensity during wet calibration");
        return false;
    }

    // 存储湿润基准到成员变量
    _calibration.wetBaseline = intensity;
    _calibration.timestamp = millis();

    // 如果干燥基准也已设置，标记校准数据为有效
    if (_calibration.dryBaseline > 0)
    {
        _calibration.isValid = true;
    }

    // 通过SerialPubSub发布校准结果消息
    publishCalibration("wet", _calibration.wetBaseline, true);

    return true;
}

void MoistureSensor::setGain(as7341_gain_t gain)
{
    _gain = gain;
    _sensor.setGain(gain);
}

void MoistureSensor::setIntegrationTime(uint16_t time)
{
    _integrationTime = time;
    _sensor.setATIME(time);
}

void MoistureSensor::setIRLED(bool state)
{
    // 保存状态
    _irledState = state;

    // 设置LED引脚状态
    digitalWrite(_irledPin, state ? HIGH : LOW);

    // 发布LED状态到"irled/status"主题
    _pubsub->publish("irled/status", state ? "on" : "off");

    // LED稳定延迟（10ms）
    delay(10);
}

void MoistureSensor::publishMeasurement(const MeasurementResult &result)
{
    // 构建JSON格式消息
    char payload[128];
    snprintf(payload, sizeof(payload),
             "{\"paper_present\":%s,\"moisture\":%.1f,\"is_dry\":%s,\"timestamp\":%lu}",
             result.paperPresent ? "true" : "false",
             result.moisturePercent,
             (result.moisturePercent < 5.0) ? "true" : "false",
             millis());

    _pubsub->publish("moisture/data", payload);
}

void MoistureSensor::publishError(const char *error)
{
    char payload[128];
    snprintf(payload, sizeof(payload), "{\"error\":\"%s\"}", error);
    _pubsub->publish("moisture/error", payload);
}

void MoistureSensor::publishCalibration(const char *type, float baseline, bool success)
{
    char payload[128];
    snprintf(payload, sizeof(payload),
             "{\"type\":\"%s\",\"baseline\":%.1f,\"success\":%s}",
             type, baseline, success ? "true" : "false");
    _pubsub->publish("moisture/calibration", payload);
}

void MoistureSensor::publishConfig()
{
    char payload[128];
    snprintf(payload, sizeof(payload),
             "{\"gain\":%d,\"integration_time\":%d}",
             _gain, _integrationTime);
    _pubsub->publish("moisture/config/response", payload);
}

bool MoistureSensor::handleSaturation(uint16_t *readings)
{
    // 检查NIR通道是否饱和
    if (readings[AS7341_CHANNEL_NIR] >= SATURATION_THRESHOLD)
    {
        // 传感器饱和，尝试降低增益
        as7341_gain_t newGain = decreaseGain(_gain);

        if (newGain != _gain)
        {
            // 成功降低增益
            setGain(newGain);
            return true; // 需要重新测量
        }
        else
        {
            // 已经是最低增益，无法进一步降低
            publishError("Sensor saturated at minimum gain");
            return false; // 无法调整，但不重试
        }
    }

    return false; // 未饱和，继续正常测量
}

as7341_gain_t MoistureSensor::decreaseGain(as7341_gain_t currentGain)
{
    // 降低增益到下一个较低的级别
    switch (currentGain)
    {
    case AS7341_GAIN_512X:
        return AS7341_GAIN_256X;
    case AS7341_GAIN_256X:
        return AS7341_GAIN_128X;
    case AS7341_GAIN_128X:
        return AS7341_GAIN_64X;
    case AS7341_GAIN_64X:
        return AS7341_GAIN_32X;
    case AS7341_GAIN_32X:
        return AS7341_GAIN_16X;
    case AS7341_GAIN_16X:
        return AS7341_GAIN_8X;
    case AS7341_GAIN_8X:
        return AS7341_GAIN_4X;
    case AS7341_GAIN_4X:
        return AS7341_GAIN_2X;
    case AS7341_GAIN_2X:
        return AS7341_GAIN_1X;
    case AS7341_GAIN_1X:
        return AS7341_GAIN_0_5X;
    case AS7341_GAIN_0_5X:
        return AS7341_GAIN_0_5X; // 已经是最低增益
    default:
        return currentGain;
    }
}

// 静态回调函数
void MoistureSensor::measureCallback(const char *topic, const char *payload)
{
    if (_instance)
    {
        MeasurementResult result = _instance->measure();
        if (result.isValid)
        {
            _instance->publishMeasurement(result);
        }
    }
}

void MoistureSensor::calibrateCallback(const char *topic, const char *payload)
{
    if (_instance)
    {
        // 解析校准类型
        // 简单的字符串匹配
        if (strstr(payload, "dry") != nullptr)
        {
            _instance->calibrateDry();
            // calibrateDry() already publishes the result
        }
        else if (strstr(payload, "wet") != nullptr)
        {
            _instance->calibrateWet();
            // calibrateWet() already publishes the result
        }
        else
        {
            _instance->publishError("Invalid calibration type. Use 'dry' or 'wet'");
        }
    }
}

void MoistureSensor::configCallback(const char *topic, const char *payload)
{
    if (_instance)
    {
        // 解析配置参数并更新
        // 简单的JSON解析（查找gain和integration_time字段）

        // 解析gain参数
        const char *gainStr = strstr(payload, "\"gain\"");
        if (gainStr != nullptr)
        {
            // 查找冒号后的数字
            const char *colonPos = strchr(gainStr, ':');
            if (colonPos != nullptr)
            {
                int gainValue = atoi(colonPos + 1);
                // 将整数值映射到as7341_gain_t枚举
                as7341_gain_t gain;
                switch (gainValue)
                {
                case 0:
                    gain = AS7341_GAIN_0_5X;
                    break;
                case 1:
                    gain = AS7341_GAIN_1X;
                    break;
                case 2:
                    gain = AS7341_GAIN_2X;
                    break;
                case 4:
                    gain = AS7341_GAIN_4X;
                    break;
                case 8:
                    gain = AS7341_GAIN_8X;
                    break;
                case 16:
                    gain = AS7341_GAIN_16X;
                    break;
                case 32:
                    gain = AS7341_GAIN_32X;
                    break;
                case 64:
                    gain = AS7341_GAIN_64X;
                    break;
                case 128:
                    gain = AS7341_GAIN_128X;
                    break;
                case 256:
                    gain = AS7341_GAIN_256X;
                    break;
                case 512:
                    gain = AS7341_GAIN_512X;
                    break;
                default:
                    gain = AS7341_GAIN_128X;
                    break; // 默认值
                }
                _instance->setGain(gain);
            }
        }

        // 解析integration_time参数
        const char *timeStr = strstr(payload, "\"integration_time\"");
        if (timeStr != nullptr)
        {
            // 查找冒号后的数字
            const char *colonPos = strchr(timeStr, ':');
            if (colonPos != nullptr)
            {
                uint16_t integrationTime = atoi(colonPos + 1);
                _instance->setIntegrationTime(integrationTime);
            }
        }

        // 发布配置响应到"moisture/config/response"
        _instance->publishConfig();
    }
}

void MoistureSensor::irledControlCallback(const char *topic, const char *payload)
{
    if (_instance == nullptr)
        return;

    // 直接比较字符串,避免使用 String 对象
    if (strcmp(payload, "on") == 0 || strcmp(payload, "1") == 0)
    {
        _instance->setIRLED(true);
    }
    else if (strcmp(payload, "off") == 0 || strcmp(payload, "0") == 0)
    {
        _instance->setIRLED(false);
    }
}

void MoistureSensor::irledGetCallback(const char *topic, const char *payload)
{
    if (_instance == nullptr)
        return;

    _instance->_pubsub->publish("irled/status", _instance->_irledState ? "on" : "off");
}
