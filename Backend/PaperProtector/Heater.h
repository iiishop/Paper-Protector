#ifndef HEATER_H
#define HEATER_H

#include <Arduino.h>
#include "SerialPubSub.h"

class Heater {
public:
    Heater(SerialPubSub* pubsub, int heaterPin);
    
    void begin();
    
    void loop();
    
    void setPower(int power);
    
    int getCurrentPower() const;
    
    void publishCurrentStatus();
    
private:
    SerialPubSub* _pubsub;
    int _heaterPin;
    int _currentPower;
    
    static void powerCallback(const char* topic, const char* payload);
    static void queryCallback(const char* topic, const char* payload);
    static Heater* _instance;
    
    int constrainPower(int power);
    void applyPower(int power);
    void publishStatus();
    void publishError(const char* error);
};

#endif
