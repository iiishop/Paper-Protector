#ifndef SERIAL_PUBSUB_H
#define SERIAL_PUBSUB_H

#include <Arduino.h>

// 最大订阅数量
#define MAX_SUBSCRIPTIONS 16
// 最大主题长度
#define MAX_TOPIC_LENGTH 24
// 最大消息长度
#define MAX_MESSAGE_LENGTH 64

typedef void (*MessageCallback)(const char *topic, const char *payload);

struct Subscription
{
    char topic[MAX_TOPIC_LENGTH];
    MessageCallback callback;
    bool active;
};

class SerialPubSub
{
public:
    SerialPubSub();

    void begin(long baudRate = 9600);

    bool publish(const char *topic, const char *payload);
    bool publish(const char *topic, int value);
    bool publish(const char *topic, float value, int decimals = 2);
    bool publish(const char *topic, bool value);

    bool subscribe(const char *topic, MessageCallback callback);

    bool unsubscribe(const char *topic);

    void loop();

private:
    Subscription subscriptions[MAX_SUBSCRIPTIONS];
    char receiveBuffer[MAX_MESSAGE_LENGTH];
    int bufferIndex;

    void parseMessage(const char *message);

    int findSubscription(const char *topic);

    int findFreeSlot();

    void sendMessage(const char *topic, const char *payload);
};

#endif
