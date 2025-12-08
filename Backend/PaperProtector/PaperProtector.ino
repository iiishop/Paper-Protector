#include "SerialPubSub.h"
#include "StepperMotor.h"
#include "FanController.h"
#include "MoistureSensor.h"

#define DIR_PIN 2
#define STEP_PIN 3
#define FAN_PIN 5
#define IRLED_PIN 4

SerialPubSub pubsub;

StepperMotor stepper(&pubsub, DIR_PIN, STEP_PIN);

FanController fan(&pubsub, FAN_PIN);

MoistureSensor moistureSensor(&pubsub, IRLED_PIN);

void setup()
{
    pubsub.begin(9600);

    // 启动消息
    delay(1000);

    // 清空串口缓冲区（防止启动时的垃圾数据）
    while (Serial.available())
    {
        Serial.read();
    }

    pubsub.publish("system/status", "ready");

    stepper.begin();

    fan.begin();

    // 清空缓冲区
    while (Serial.available())
    {
        Serial.read();
    }

    // 最后初始化可能阻塞的传感器
    moistureSensor.begin();

    // 再次清空缓冲区
    while (Serial.available())
    {
        Serial.read();
    }

    // 发布初始状态
    pubsub.publish("system/status", "initialized");
}

void loop()
{
    pubsub.loop();

    stepper.loop();

    fan.loop();

    moistureSensor.loop();
}
