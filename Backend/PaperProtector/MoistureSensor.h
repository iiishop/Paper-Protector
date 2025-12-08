#ifndef MOISTURE_SENSOR_H
#define MOISTURE_SENSOR_H

#include <Arduino.h>
#include <Adafruit_AS7341.h>
#include "SerialPubSub.h"

class MoistureSensor {
public:
    // 测量结果结构体
    struct MeasurementResult {
        bool paperPresent;      // 纸张是否存在
        float moisturePercent;  // 湿度百分比 (0-100)
        bool isValid;           // 测量是否有效
    };
    
    // 校准数据结构体
    struct CalibrationData {
        float dryBaseline;      // 干燥纸张的NIR强度基准
        float wetBaseline;      // 湿润纸张的NIR强度基准
        uint32_t timestamp;     // 校准时间戳
        bool isValid;           // 校准数据有效性
    };
    
    // 构造函数
    MoistureSensor(SerialPubSub* pubsub, int irledPin);
    
    // 初始化传感器
    bool begin();
    
    // 主循环处理
    void loop();
    
    // 执行测量（核心函数）
    MeasurementResult measure();
    
    // 校准功能
    bool calibrateDry();    // 校准干燥纸张
    bool calibrateWet();    // 校准湿润纸张
    
    // 配置参数
    void setGain(as7341_gain_t gain);
    void setIntegrationTime(uint16_t time);
    
private:
    SerialPubSub* _pubsub;
    Adafruit_AS7341 _sensor;
    int _irledPin;  // Arduino数字引脚，用于控制外部IRLED
    
    // 校准数据
    CalibrationData _calibration;
    
    // 测量频率限制
    unsigned long _lastMeasurementTime;
    static const unsigned long MIN_MEASUREMENT_INTERVAL = 500; // 最小测量间隔(ms)
    
    // 传感器配置
    as7341_gain_t _gain;
    uint16_t _integrationTime;
    
    // 重试配置
    static const int MAX_RETRIES = 3;
    static const int RETRY_DELAY_MS = 50;
    
    // 饱和检测阈值（AS7341的16位ADC最大值）
    static const uint16_t SATURATION_THRESHOLD = 65000; // 接近65535的饱和值
    
    // 增益调整辅助方法
    bool handleSaturation(uint16_t* readings);
    as7341_gain_t decreaseGain(as7341_gain_t currentGain);
    
    // 内部方法
    float readNIRIntensity();
    float readAmbientIntensity();
    bool detectPaper(float intensity, float ambient);
    float calculateMoisture(float intensity);
    void publishMeasurement(const MeasurementResult& result);
    void publishError(const char* error);
    void publishCalibration(const char* type, float baseline, bool success);
    void publishConfig();
    
    // 静态回调
    static void measureCallback(const char* topic, const char* payload);
    static void calibrateCallback(const char* topic, const char* payload);
    static void configCallback(const char* topic, const char* payload);
    static MoistureSensor* _instance;
};

#endif
