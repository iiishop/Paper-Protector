#include "FanController.h"

FanController *FanController::_instance = nullptr;

FanController::FanController(SerialPubSub *pubsub, int fanPin)
    : _pubsub(pubsub), _fanPin(fanPin), _currentSpeed(0)
{
    _instance = this;
}

void FanController::begin()
{
    pinMode(_fanPin, OUTPUT);
    analogWrite(_fanPin, 0);

    _pubsub->subscribe("fan/speed", speedCallback);
    _pubsub->subscribe("fan/query", queryCallback);
}

void FanController::loop()
{
}

int FanController::constrainSpeed(int speed)
{
    if (speed < 0)
        return 0;
    if (speed > 255)
        return 255;
    return speed;
}

void FanController::setSpeed(int speed)
{
    int constrainedSpeed = constrainSpeed(speed);
    applySpeed(constrainedSpeed);
}

void FanController::applySpeed(int speed)
{
    _currentSpeed = speed;
    analogWrite(_fanPin, speed);
    publishStatus();
}

int FanController::getCurrentSpeed() const
{
    return _currentSpeed;
}

void FanController::publishStatus()
{
    char statusMsg[16];
    sprintf(statusMsg, "%d", _currentSpeed);
    _pubsub->publish("fan/status", statusMsg);
}

void FanController::publishError(const char *error)
{
    _pubsub->publish("fan/error", error);
}

void FanController::publishCurrentStatus()
{
    publishStatus();
}

void FanController::speedCallback(const char *topic, const char *payload)
{
    if (_instance == nullptr)
        return;

    if (payload == nullptr || payload[0] == '\0')
    {
        _instance->publishError("Empty");
        return;
    }

    char *endPtr;
    long speed = strtol(payload, &endPtr, 10);

    if (*endPtr != '\0')
    {
        _instance->publishError("Invalid");
        return;
    }

    _instance->setSpeed((int)speed);
}

void FanController::queryCallback(const char *topic, const char *payload)
{
    if (_instance == nullptr)
        return;

    _instance->publishCurrentStatus();
}
