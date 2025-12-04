#ifndef FAN_CONTROLLER_H
#define FAN_CONTROLLER_H

#include <Arduino.h>
#include "SerialPubSub.h"

class FanController {
public:
    FanController(SerialPubSub* pubsub, int fanPin);
    
    void begin();
    
    void loop();
    
    void setSpeed(int speed);
    
    int getCurrentSpeed() const;
    
    void publishCurrentStatus();
    
private:
    SerialPubSub* _pubsub;
    int _fanPin;
    int _currentSpeed;
    
    static void speedCallback(const char* topic, const char* payload);
    static void queryCallback(const char* topic, const char* payload);
    static FanController* _instance;
    
    int constrainSpeed(int speed);
    void applySpeed(int speed);
    void publishStatus();
    void publishError(const char* error);
};

#endif
