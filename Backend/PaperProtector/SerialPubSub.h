#ifndef SERIAL_PUBSUB_H
#define SERIAL_PUBSUB_H

#include <Arduino.h>

// 最大订阅数量
#define MAX_SUBSCRIPTIONS 16
// 最大主题长度
#define MAX_TOPIC_LENGTH 24
// 最大消息长度
#define MAX_MESSAGE_LENGTH 64

// 回调函数类型定义
typedef void (*MessageCallback)(const char *topic, const char *payload);

// 订阅信息结构
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

    // 初始化串口
    void begin(long baudRate = 9600);

    // 发布消息
    bool publish(const char *topic, const char *payload);
    bool publish(const char *topic, int value);
    bool publish(const char *topic, float value, int decimals = 2);
    bool publish(const char *topic, bool value);

    // 订阅主题
    bool subscribe(const char *topic, MessageCallback callback);

    // 取消订阅
    bool unsubscribe(const char *topic);

    // 处理接收消息（在loop中调用）
    void loop();

private:
    Subscription subscriptions[MAX_SUBSCRIPTIONS];
    char receiveBuffer[MAX_MESSAGE_LENGTH];
    int bufferIndex;

    // 解析接收到的消息
    void parseMessage(const char *message);

    // 查找订阅
    int findSubscription(const char *topic);

    // 查找空闲订阅槽
    int findFreeSlot();

    // 格式化并发送消息
    void sendMessage(const char *topic, const char *payload);
};

#endif
