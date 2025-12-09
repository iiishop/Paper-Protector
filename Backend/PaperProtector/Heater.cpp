#include "Heater.h"

Heater *Heater::_instance = nullptr;

Heater::Heater(SerialPubSub *pubsub, int heaterPin)
    : _pubsub(pubsub), _heaterPin(heaterPin), _currentPower(0)
{
    _instance = this;
}

void Heater::begin()
{
    pinMode(_heaterPin, OUTPUT);
    analogWrite(_heaterPin, 0);

    bool sub1 = _pubsub->subscribe("heater/power", powerCallback);
    bool sub2 = _pubsub->subscribe("heater/query", queryCallback);

    // 调试: 确认订阅
    if (sub1 && sub2)
    {
        _pubsub->publish("heater/debug", "subscribed_ok");
    }
    else
    {
        _pubsub->publish("heater/debug", "subscribe_failed");
    }
}

void Heater::loop()
{
}

int Heater::constrainPower(int power)
{
    if (power < 0)
        return 0;
    if (power > 255)
        return 255;
    return power;
}

void Heater::setPower(int power)
{
    int constrainedPower = constrainPower(power);
    applyPower(constrainedPower);
}

void Heater::applyPower(int power)
{
    _currentPower = power;
    analogWrite(_heaterPin, power);
    publishStatus();
}

int Heater::getCurrentPower() const
{
    return _currentPower;
}

void Heater::publishStatus()
{
    char statusMsg[16];
    sprintf(statusMsg, "%d", _currentPower);
    _pubsub->publish("heater/status", statusMsg);
}

void Heater::publishError(const char *error)
{
    _pubsub->publish("heater/error", error);
}

void Heater::publishCurrentStatus()
{
    publishStatus();
}

void Heater::powerCallback(const char *topic, const char *payload)
{
    // 调试: 确认收到消息
    if (_instance != nullptr)
    {
        _instance->_pubsub->publish("heater/debug", "callback_called");
    }

    if (_instance == nullptr)
        return;

    if (payload == nullptr || payload[0] == '\0')
    {
        _instance->publishError("Empty");
        return;
    }

    char *endPtr;
    long power = strtol(payload, &endPtr, 10);

    if (*endPtr != '\0')
    {
        _instance->publishError("Invalid");
        return;
    }

    _instance->setPower((int)power);
}

void Heater::queryCallback(const char *topic, const char *payload)
{
    if (_instance == nullptr)
        return;

    _instance->publishCurrentStatus();
}
