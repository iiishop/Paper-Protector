#include "SerialPubSub.h"

// 构造函数
SerialPubSub::SerialPubSub() {
    bufferIndex = 0;
    // 初始化所有订阅为非活动状态
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        subscriptions[i].active = false;
        subscriptions[i].topic[0] = '\0';
        subscriptions[i].callback = nullptr;
    }
    // 清空接收缓冲区
    receiveBuffer[0] = '\0';
}

// 初始化串口
void SerialPubSub::begin(long baudRate) {
    Serial.begin(baudRate);
    bufferIndex = 0;
}

// 格式化并发送消息
void SerialPubSub::sendMessage(const char* topic, const char* payload) {
    // 验证主题不为空且不包含冒号
    if (topic == nullptr || topic[0] == '\0') {
        return;
    }
    
    // 检查主题中是否包含冒号
    for (int i = 0; topic[i] != '\0'; i++) {
        if (topic[i] == ':') {
            return; // 主题不能包含冒号
        }
    }
    
    // 发送格式: TOPIC:PAYLOAD\n
    Serial.print(topic);
    Serial.print(':');
    if (payload != nullptr) {
        Serial.print(payload);
    }
    Serial.print('\n');
}

// 发布消息 - 字符串版本
bool SerialPubSub::publish(const char* topic, const char* payload) {
    if (topic == nullptr || topic[0] == '\0') {
        return false;
    }
    sendMessage(topic, payload);
    return true;
}

// 发布消息 - 整数版本
bool SerialPubSub::publish(const char* topic, int value) {
    if (topic == nullptr || topic[0] == '\0') {
        return false;
    }
    char buffer[12]; // 足够存储32位整数
    itoa(value, buffer, 10);
    sendMessage(topic, buffer);
    return true;
}

// 发布消息 - 浮点数版本
bool SerialPubSub::publish(const char* topic, float value, int decimals) {
    if (topic == nullptr || topic[0] == '\0') {
        return false;
    }
    char buffer[16];
    dtostrf(value, 0, decimals, buffer);
    sendMessage(topic, buffer);
    return true;
}

// 发布消息 - 布尔版本
bool SerialPubSub::publish(const char* topic, bool value) {
    if (topic == nullptr || topic[0] == '\0') {
        return false;
    }
    sendMessage(topic, value ? "true" : "false");
    return true;
}

// 处理接收消息（在loop中调用）
void SerialPubSub::loop() {
    while (Serial.available() > 0) {
        char c = Serial.read();
        
        // 检查消息边界（换行符）
        if (c == '\n') {
            if (bufferIndex > 0) {
                // 添加字符串结束符
                receiveBuffer[bufferIndex] = '\0';
                // 解析消息
                parseMessage(receiveBuffer);
                // 重置缓冲区
                bufferIndex = 0;
            }
        } else {
            // 添加字符到缓冲区
            if (bufferIndex < MAX_MESSAGE_LENGTH - 1) {
                receiveBuffer[bufferIndex++] = c;
            } else {
                // 缓冲区溢出，丢弃整个消息
                bufferIndex = 0;
            }
        }
    }
}

// 解析接收到的消息
void SerialPubSub::parseMessage(const char* message) {
    // 查找冒号分隔符
    const char* colonPos = strchr(message, ':');
    
    // 验证消息格式
    if (colonPos == nullptr) {
        // 无效格式：缺少冒号
        return;
    }
    
    // 提取主题
    int topicLength = colonPos - message;
    if (topicLength == 0 || topicLength >= MAX_TOPIC_LENGTH) {
        // 无效格式：主题为空或过长
        return;
    }
    
    char topic[MAX_TOPIC_LENGTH];
    strncpy(topic, message, topicLength);
    topic[topicLength] = '\0';
    
    // 提取payload（冒号后的所有内容）
    const char* payload = colonPos + 1;
    
    // 查找匹配的订阅并调用回调
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (subscriptions[i].active && strcmp(subscriptions[i].topic, topic) == 0) {
            if (subscriptions[i].callback != nullptr) {
                subscriptions[i].callback(topic, payload);
            }
        }
    }
}

// 查找订阅
int SerialPubSub::findSubscription(const char* topic) {
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (subscriptions[i].active && strcmp(subscriptions[i].topic, topic) == 0) {
            return i;
        }
    }
    return -1; // 未找到
}

// 查找空闲订阅槽
int SerialPubSub::findFreeSlot() {
    for (int i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (!subscriptions[i].active) {
            return i;
        }
    }
    return -1; // 订阅表已满
}

// 订阅主题
bool SerialPubSub::subscribe(const char* topic, MessageCallback callback) {
    if (topic == nullptr || topic[0] == '\0' || callback == nullptr) {
        return false;
    }
    
    // 检查主题长度
    if (strlen(topic) >= MAX_TOPIC_LENGTH) {
        return false;
    }
    
    // 检查是否已经订阅
    int existingIndex = findSubscription(topic);
    if (existingIndex >= 0) {
        // 更新现有订阅的回调
        subscriptions[existingIndex].callback = callback;
        return true;
    }
    
    // 查找空闲槽位
    int freeSlot = findFreeSlot();
    if (freeSlot < 0) {
        // 订阅表已满
        return false;
    }
    
    // 添加新订阅
    strcpy(subscriptions[freeSlot].topic, topic);
    subscriptions[freeSlot].callback = callback;
    subscriptions[freeSlot].active = true;
    
    return true;
}

// 取消订阅
bool SerialPubSub::unsubscribe(const char* topic) {
    if (topic == nullptr || topic[0] == '\0') {
        return false;
    }
    
    int index = findSubscription(topic);
    if (index < 0) {
        // 未找到订阅
        return false;
    }
    
    // 清除订阅
    subscriptions[index].active = false;
    subscriptions[index].topic[0] = '\0';
    subscriptions[index].callback = nullptr;
    
    return true;
}
