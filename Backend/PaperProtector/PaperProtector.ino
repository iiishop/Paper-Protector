#include "SerialPubSub.h"
#include "StepperMotor.h"
#include "FanController.h"
#include "DHT22Sensor.h"
#include "Heater.h"
// #include "MoistureSensor.h"  // 暂时不使用 AS7341 和 IR LED

#define DIR_PIN 2
#define STEP_PIN 3
#define FAN_PIN 5
#define DHT_PIN 8
#define HEATER_PIN 6
// #define IRLED_PIN 4  // 暂时不使用

SerialPubSub pubsub;

StepperMotor stepper(&pubsub, DIR_PIN, STEP_PIN);

FanController fan(&pubsub, FAN_PIN);

DHT22Sensor dhtSensor(&pubsub, DHT_PIN);

Heater heater(&pubsub, HEATER_PIN);

// MoistureSensor moistureSensor(&pubsub, IRLED_PIN);  // 暂时不使用

void setup()
{
    pubsub.begin(9600);

    delay(1000);

    while (Serial.available())
    {
        Serial.read();
    }

    pubsub.publish("system/status", "ready");

    stepper.begin();

    fan.begin();

    dhtSensor.begin();

    heater.begin();

    // 暂时不使用 AS7341 传感器和 IR LED
    // // 清空缓冲区
    // while (Serial.available())
    // {
    //     Serial.read();
    // }

    // // 最后初始化可能阻塞的传感器
    // moistureSensor.begin();

    // // 再次清空缓冲区
    // while (Serial.available())
    // {
    //     Serial.read();
    // }

    // 发布初始状态
    pubsub.publish("system/status", "initialized");
}

void loop()
{
    pubsub.loop();

    stepper.loop();

    fan.loop();

    dhtSensor.loop();

    heater.loop();

    // moistureSensor.loop();  // 暂时不使用
}
