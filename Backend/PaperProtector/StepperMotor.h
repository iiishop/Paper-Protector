#ifndef STEPPER_MOTOR_H
#define STEPPER_MOTOR_H

#include <Arduino.h>
#include "SerialPubSub.h"

class StepperMotor
{
public:
    // 构造函数
    StepperMotor(SerialPubSub *pubsub, int dirPin, int stepPin);

    // 初始化
    void begin();

    // 循环处理（如果需要非阻塞控制）
    void loop();

    // 旋转指定圈数（正数=顺时针，负数=逆时针）
    void rotate(float revolutions);

    // 设置步进电机参数
    void setStepsPerRevolution(int steps);
    void setStepDelay(unsigned long delayMicros);

    // 获取当前状态
    bool isBusy() const;

private:
    SerialPubSub *_pubsub;
    int _dirPin;
    int _stepPin;
    int _stepsPerRevolution;
    unsigned long _stepDelayMicros;
    bool _isBusy;

    // 位置跟踪
    long _currentSteps;     // 当前步数（可正可负）
    float _mmPerRevolution; // 每圈移动的毫米数

    // 消息回调处理
    static void messageCallback(const char *topic, const char *payload);
    static void configCallback(const char *topic, const char *payload);
    static void calibrateCallback(const char *topic, const char *payload);
    static void homeCallback(const char *topic, const char *payload);
    static void positionCallback(const char *topic, const char *payload);
    static StepperMotor *_instance; // 用于静态回调

    // 内部方法
    void executeRotation(float revolutions);
    void publishStatus(const char *status);
    void publishError(const char *error);
    void publishConfig();
    void publishPosition();
};

#endif
