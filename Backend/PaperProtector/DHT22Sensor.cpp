#include "DHT22Sensor.h"

DHT22Sensor *DHT22Sensor::_instance = nullptr;

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

void DHT22Sensor::begin()
{
    _dht->begin();

    _pubsub->subscribe("dht/query", queryCallback);

    _startTime = millis();

    _pubsub->publish("dht/status", "initializing");
}

void DHT22Sensor::loop()
{
    unsigned long currentTime = millis();

    if (currentTime - _startTime < 500)
    {
        return;
    }

    if (_lastReadTime == 0)
    {
        _pubsub->publish("dht/status", "ready");
        readAndPublish();
        _lastReadTime = currentTime;
        return;
    }

    if (currentTime - _lastReadTime >= _readInterval)
    {
        readAndPublish();
        _lastReadTime = currentTime;
    }
}

void DHT22Sensor::readAndPublish()
{
    float humidity = _dht->readHumidity();
    float temperature = _dht->readTemperature();

    if (isnan(humidity) || isnan(temperature))
    {
        _pubsub->publish("dht/error", "Read failed");
        return;
    }

    if (!_emaInitialized)
    {
        _emaTemperature = temperature;
        _emaHumidity = humidity;
        _emaInitialized = true;
    }
    else
    {
        _emaTemperature = _emaAlpha * temperature + (1.0 - _emaAlpha) * _emaTemperature;
        _emaHumidity = _emaAlpha * humidity + (1.0 - _emaAlpha) * _emaHumidity;
    }

    _lastTemperature = _emaTemperature;
    _lastHumidity = _emaHumidity;

    publishReading();
}

void DHT22Sensor::publishReading()
{
    char tempStr[16];
    char humStr[16];
    char dataMsg[40];

    dtostrf(_lastTemperature, 4, 1, tempStr);
    dtostrf(_lastHumidity, 4, 1, humStr);

    _pubsub->publish("dht/temperature", tempStr);

    _pubsub->publish("dht/humidity", humStr);

    snprintf(dataMsg, sizeof(dataMsg), "%s,%s", tempStr, humStr);
    _pubsub->publish("dht/data", dataMsg);
}

void DHT22Sensor::queryCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        if (!isnan(_instance->_lastTemperature) && !isnan(_instance->_lastHumidity))
        {
            _instance->publishReading();
        }
        else
        {
            _instance->readAndPublish();
        }
    }
}
