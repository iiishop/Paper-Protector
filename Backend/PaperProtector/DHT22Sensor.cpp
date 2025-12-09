#include "DHT22Sensor.h"

// 静态实例指针初始化
DHT22Sensor *DHT22Sensor::_instance = nullptr;

// 构造函数
DHT22Sensor::DHT22Sensor(SerialPubSub *pubsub, int dhtPin)
    : _pubsub(pubsub),
      _dhtPin(dhtPin),
      _lastReadTime(0),
      _readInterval(200), // 200ms读取间隔，更快响应
      _startTime(0),
      _lastTemperature(NAN),
      _lastHumidity(NAN),
      _emaTemperature(NAN),
      _emaHumidity(NAN),
      _emaInitialized(false),
      _emaAlpha(0.3) // 0.3平滑系数：平衡响应速度和稳定性
{
    _instance = this;
    _dht = new DHT(_dhtPin, DHT22);
}

// 初始化方法
void DHT22Sensor::begin()
{
    // 初始化DHT传感器
    _dht->begin();

    // 订阅查询主题
    _pubsub->subscribe("dht/query", queryCallback);

    // 记录启动时间
    _startTime = millis();

    // 发布初始状态
    _pubsub->publish("dht/status", "initializing");
}

// 循环处理方法
void DHT22Sensor::loop()
{
    unsigned long currentTime = millis();

    // 缩短启动等待时间到500ms（DHT22通常在这个时间后就能读取）
    if (currentTime - _startTime < 500)
    {
        return;
    }

    // 首次读取
    if (_lastReadTime == 0)
    {
        _pubsub->publish("dht/status", "ready");
        readAndPublish();
        _lastReadTime = currentTime;
        return;
    }

    // 检查是否到达读取间隔
    if (currentTime - _lastReadTime >= _readInterval)
    {
        readAndPublish();
        _lastReadTime = currentTime;
    }
}

// 读取并发布数据
void DHT22Sensor::readAndPublish()
{
    // 读取温湿度
    float humidity = _dht->readHumidity();
    float temperature = _dht->readTemperature();

    // 检查读取是否成功
    if (isnan(humidity) || isnan(temperature))
    {
        // 读取失败,发布错误消息
        _pubsub->publish("dht/error", "Read failed");
        return;
    }

    // 应用指数移动平均(EMA)滤波
    if (!_emaInitialized)
    {
        // 首次读取，直接使用原始值初始化
        _emaTemperature = temperature;
        _emaHumidity = humidity;
        _emaInitialized = true;
    }
    else
    {
        // EMA公式: EMA(t) = α × 新值 + (1-α) × EMA(t-1)
        _emaTemperature = _emaAlpha * temperature + (1.0 - _emaAlpha) * _emaTemperature;
        _emaHumidity = _emaAlpha * humidity + (1.0 - _emaAlpha) * _emaHumidity;
    }

    // 使用滤波后的值
    _lastTemperature = _emaTemperature;
    _lastHumidity = _emaHumidity;

    // 发布数据
    publishReading();
}

// 发布读数
void DHT22Sensor::publishReading()
{
    char tempStr[16];
    char humStr[16];
    char dataMsg[40];

    // 转换为字符串(保留1位小数)
    dtostrf(_lastTemperature, 4, 1, tempStr);
    dtostrf(_lastHumidity, 4, 1, humStr);

    // 发布温度
    _pubsub->publish("dht/temperature", tempStr);

    // 发布湿度
    _pubsub->publish("dht/humidity", humStr);

    // 发布组合数据 (格式: "temp,humidity")
    snprintf(dataMsg, sizeof(dataMsg), "%s,%s", tempStr, humStr);
    _pubsub->publish("dht/data", dataMsg);
}

// 查询回调
void DHT22Sensor::queryCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        // 立即发布当前读数
        if (!isnan(_instance->_lastTemperature) && !isnan(_instance->_lastHumidity))
        {
            _instance->publishReading();
        }
        else
        {
            // 如果还没有读数,执行一次读取
            _instance->readAndPublish();
        }
    }
}
