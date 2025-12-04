#include "SerialPubSub.h"
#include "StepperMotor.h"
#include "FanController.h"

#define DIR_PIN 2
#define STEP_PIN 3
#define FAN_PIN 5

SerialPubSub pubsub;

StepperMotor stepper(&pubsub, DIR_PIN, STEP_PIN);

FanController fan(&pubsub, FAN_PIN);

void setup() {
    pubsub.begin(9600);
    
    stepper.begin();
    
    fan.begin();
}

void loop() {
    pubsub.loop();
    
    stepper.loop();
    
    fan.loop();
}
