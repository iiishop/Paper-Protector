#ifndef DHT22_SENSOR_H
#define DHT22_SENSOR_H

#include <Arduino.h>
#include <DHT.h>
#include "SerialPubSub.h"

class DHT22Sensor
{
public:
    DHT22Sensor(SerialPubSub *pubsub, int dhtPin);

    void begin();

    void loop();

private:
    SerialPubSub *_pubsub;
    DHT *_dht;
    int _dhtPin;

    unsigned long _lastReadTime;
    unsigned long _readInterval; // 读取间隔(毫秒)
    unsigned long _startTime;    // 启动时间(用于等待传感器稳定)

    float _lastTemperature;
    float _lastHumidity;

    static void queryCallback(const char *topic, const char *payload);
    static DHT22Sensor *_instance;

    void readAndPublish();
    void publishReading();
};

#endif
