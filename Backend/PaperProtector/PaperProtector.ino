#include "SerialPubSub.h"
#include "StepperMotor.h"

// 引脚定义
#define DIR_PIN 2
#define STEP_PIN 3

// 创建SerialPubSub实例
SerialPubSub pubsub;

// 创建StepperMotor实例
StepperMotor stepper(&pubsub, DIR_PIN, STEP_PIN);

void setup() {
    // 初始化串口通信
    pubsub.begin(9600);
    
    // 初始化步进电机模块
    stepper.begin();
}

void loop() {
    // 处理串口消息
    pubsub.loop();
    
    // 处理步进电机任务
    stepper.loop();
}
