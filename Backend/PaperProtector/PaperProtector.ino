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

void setup() {
    pubsub.begin(9600);
    
    stepper.begin();
    
    fan.begin();
    
    moistureSensor.begin();
}

void loop() {
    pubsub.loop();
    
    stepper.loop();
    
    fan.loop();
    
    moistureSensor.loop();
}
