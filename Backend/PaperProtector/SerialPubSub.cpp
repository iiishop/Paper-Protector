#include "SerialPubSub.h"

SerialPubSub::SerialPubSub()
{
    bufferIndex = 0;
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++)
    {
        subscriptions[i].active = false;
        subscriptions[i].topic[0] = '\0';
        subscriptions[i].callback = nullptr;
    }
    receiveBuffer[0] = '\0';
}

void SerialPubSub::begin(long baudRate)
{
    Serial.begin(baudRate);
    bufferIndex = 0;
}

void SerialPubSub::sendMessage(const char *topic, const char *payload)
{
    if (topic == nullptr || topic[0] == '\0')
    {
        return;
    }

    for (int i = 0; topic[i] != '\0'; i++)
    {
        if (topic[i] == ':')
        {
            return; // 主题不能包含冒号
        }
    }

    Serial.print(topic);
    Serial.print(':');
    if (payload != nullptr)
    {
        Serial.print(payload);
    }
    Serial.print('\n');
}

bool SerialPubSub::publish(const char *topic, const char *payload)
{
    if (topic == nullptr || topic[0] == '\0')
    {
        return false;
    }
    sendMessage(topic, payload);
    return true;
}

bool SerialPubSub::publish(const char *topic, int value)
{
    if (topic == nullptr || topic[0] == '\0')
    {
        return false;
    }
    char buffer[12]; // 足够存储32位整数
    itoa(value, buffer, 10);
    sendMessage(topic, buffer);
    return true;
}

bool SerialPubSub::publish(const char *topic, float value, int decimals)
{
    if (topic == nullptr || topic[0] == '\0')
    {
        return false;
    }
    char buffer[16];
    dtostrf(value, 0, decimals, buffer);
    sendMessage(topic, buffer);
    return true;
}

bool SerialPubSub::publish(const char *topic, bool value)
{
    if (topic == nullptr || topic[0] == '\0')
    {
        return false;
    }
    sendMessage(topic, value ? "true" : "false");
    return true;
}

void SerialPubSub::loop()
{
    // 调试输出已禁用以避免干扰通信
    // if (Serial.available() > 0)
    // {
    //     Serial.print("Avail:");
    //     Serial.println(Serial.available());
    // }

    while (Serial.available() > 0)
    {
        char c = Serial.read();

        // 调试：显示接收到的字符（十六进制）
        // Serial.print("Byte:");
        // Serial.println((int)c, HEX);

        // 检查消息边界（换行符）
        if (c == '\n' || c == '\r')
        {
            if (bufferIndex > 0)
            {
                // 添加字符串结束符
                receiveBuffer[bufferIndex] = '\0';

                // 回显收到的消息（用于调试）
                // Serial.print("RX:");
                // Serial.println(receiveBuffer);

                // 解析消息
                parseMessage(receiveBuffer);
                // 重置缓冲区
                bufferIndex = 0;
            }
        }
        else
        {
            // 添加字符到缓冲区
            if (bufferIndex < MAX_MESSAGE_LENGTH - 1)
            {
                receiveBuffer[bufferIndex++] = c;
            }
            else
            {
                // 缓冲区溢出，丢弃整个消息
                // Serial.println("BUF_OVERFLOW");
                bufferIndex = 0;
            }
        }
    }
}

void SerialPubSub::parseMessage(const char *message)
{
    const char *colonPos = strchr(message, ':');

    if (colonPos == nullptr)
    {
        return;
    }

    int topicLength = colonPos - message;
    if (topicLength == 0 || topicLength >= MAX_TOPIC_LENGTH)
    {
        return;
    }

    char topic[MAX_TOPIC_LENGTH];
    strncpy(topic, message, topicLength);
    topic[topicLength] = '\0';

    const char *payload = colonPos + 1;

    // 调试：显示解析的主题和负载
    // Serial.print("T:");
    // Serial.print(topic);
    // Serial.print(" P:");
    // Serial.println(payload);

    // 查找匹配的订阅并调用回调
    int matchCount = 0;
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++)
    {
        if (subscriptions[i].active && strcmp(subscriptions[i].topic, topic) == 0)
        {
            matchCount++;
            if (subscriptions[i].callback != nullptr)
            {
                subscriptions[i].callback(topic, payload);
            }
        }
    }

    // 调试：显示匹配数量
    // Serial.print("Match:");
    // Serial.println(matchCount);
}

int SerialPubSub::findSubscription(const char *topic)
{
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++)
    {
        if (subscriptions[i].active && strcmp(subscriptions[i].topic, topic) == 0)
        {
            return i;
        }
    }
    return -1; // 未找到
}

int SerialPubSub::findFreeSlot()
{
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++)
    {
        if (!subscriptions[i].active)
        {
            return i;
        }
    }
    return -1; // 订阅表已满
}

bool SerialPubSub::subscribe(const char *topic, MessageCallback callback)
{
    if (topic == nullptr || topic[0] == '\0' || callback == nullptr)
    {
        return false;
    }

    if (strlen(topic) >= MAX_TOPIC_LENGTH)
    {
        return false;
    }

    int existingIndex = findSubscription(topic);
    if (existingIndex >= 0)
    {
        subscriptions[existingIndex].callback = callback;
        return true;
    }

    int freeSlot = findFreeSlot();
    if (freeSlot < 0)
    {
        return false;
    }

    strcpy(subscriptions[freeSlot].topic, topic);
    subscriptions[freeSlot].callback = callback;
    subscriptions[freeSlot].active = true;

    return true;
}

bool SerialPubSub::unsubscribe(const char *topic)
{
    if (topic == nullptr || topic[0] == '\0')
    {
        return false;
    }

    int index = findSubscription(topic);
    if (index < 0)
    {
        // 未找到订阅
        return false;
    }

    // 清除订阅
    subscriptions[index].active = false;
    subscriptions[index].topic[0] = '\0';
    subscriptions[index].callback = nullptr;

    return true;
}
