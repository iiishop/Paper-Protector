#include "StepperMotor.h"

// 静态实例指针初始化
StepperMotor *StepperMotor::_instance = nullptr;

// 构造函数
StepperMotor::StepperMotor(SerialPubSub *pubsub, int dirPin, int stepPin)
    : _pubsub(pubsub),
      _dirPin(dirPin),
      _stepPin(stepPin),
      _stepsPerRevolution(200), // 默认200步/圈 (1.8度步进角)
      _stepDelayMicros(1000),   // 默认1000微秒延迟
      _isBusy(false),
      _currentSteps(0),     // 初始位置为0
      _mmPerRevolution(1.6) // 默认每圈1.6mm (160mm / 100圈)
{
    _instance = this;
}

// 初始化方法 - 配置引脚和订阅主题
void StepperMotor::begin()
{
    // 配置DIR和STEP引脚为输出模式
    pinMode(_dirPin, OUTPUT);
    pinMode(_stepPin, OUTPUT);

    // 设置初始状态
    digitalWrite(_dirPin, LOW);
    digitalWrite(_stepPin, LOW);

    // 订阅motor/rotate主题
    _pubsub->subscribe("motor/rotate", messageCallback);

    // 订阅motor/config主题
    _pubsub->subscribe("motor/config", configCallback);

    // 订阅motor/calibrate主题（校准/调零）
    _pubsub->subscribe("motor/calibrate", calibrateCallback);

    // 订阅motor/home主题（回零）
    _pubsub->subscribe("motor/home", homeCallback);

    // 订阅motor/position/get主题（查询位置）
    _pubsub->subscribe("motor/position/get", positionCallback);

    // 发布初始配置和位置
    publishConfig();
    publishPosition();
}

// 循环处理方法（当前为空，预留用于非阻塞实现）
void StepperMotor::loop()
{
    // 预留用于未来的非阻塞实现
}

// 旋转指定圈数
void StepperMotor::rotate(float revolutions)
{
    executeRotation(revolutions);
}

// 设置每圈步数
void StepperMotor::setStepsPerRevolution(int steps)
{
    _stepsPerRevolution = steps;
}

// 设置步进延迟
void StepperMotor::setStepDelay(unsigned long delayMicros)
{
    _stepDelayMicros = delayMicros;
}

// 获取忙碌状态
bool StepperMotor::isBusy() const
{
    return _isBusy;
}

// 静态消息回调函数
void StepperMotor::messageCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        // 检查payload是否为空
        if (payload == nullptr || payload[0] == '\0')
        {
            _instance->publishError("Invalid number format");
            return;
        }

        // 验证payload是否为有效数字格式
        bool isValid = false;
        bool hasDigit = false;
        bool hasDecimal = false;
        int i = 0;

        // 允许开头的正负号
        if (payload[i] == '-' || payload[i] == '+')
        {
            i++;
        }

        // 检查剩余字符
        while (payload[i] != '\0')
        {
            if (payload[i] >= '0' && payload[i] <= '9')
            {
                hasDigit = true;
            }
            else if (payload[i] == '.' && !hasDecimal)
            {
                hasDecimal = true;
            }
            else
            {
                // 遇到无效字符
                _instance->publishError("Invalid number format");
                return;
            }
            i++;
        }

        // 必须至少有一个数字
        if (!hasDigit)
        {
            _instance->publishError("Invalid number format");
            return;
        }

        // 解析payload为浮点数
        float revolutions = atof(payload);

        // 检查电机是否忙碌
        if (_instance->isBusy())
        {
            _instance->publishError("Motor busy");
            return;
        }

        // 执行旋转
        _instance->rotate(revolutions);
    }
}

// 执行旋转操作
void StepperMotor::executeRotation(float revolutions)
{
    // 设置忙碌状态
    _isBusy = true;

    // 发布rotating状态
    publishStatus("rotating");

    // 设置方向引脚
    if (revolutions >= 0)
    {
        digitalWrite(_dirPin, HIGH); // 正数 = 顺时针
    }
    else
    {
        digitalWrite(_dirPin, LOW); // 负数 = 逆时针
    }

    // 计算总步数
    long totalSteps = (long)(abs(revolutions) * _stepsPerRevolution);

    // 生成步进脉冲
    for (long i = 0; i < totalSteps; i++)
    {
        digitalWrite(_stepPin, HIGH);
        delayMicroseconds(_stepDelayMicros);
        digitalWrite(_stepPin, LOW);
        delayMicroseconds(_stepDelayMicros);
    }

    // 更新当前步数
    if (revolutions >= 0)
    {
        _currentSteps += totalSteps;
    }
    else
    {
        _currentSteps -= totalSteps;
    }

    // 清除忙碌状态
    _isBusy = false;

    // 发布完成状态和位置
    publishStatus("idle");
    publishPosition();
}

// 发布状态消息
void StepperMotor::publishStatus(const char *status)
{
    _pubsub->publish("motor/status", status);
}

// 发布错误消息
void StepperMotor::publishError(const char *error)
{
    _pubsub->publish("motor/error", error);
}

// 静态配置回调函数
void StepperMotor::configCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        // 检查payload是否为空
        if (payload == nullptr || payload[0] == '\0')
        {
            _instance->publishError("Invalid config format");
            return;
        }

        // 解析配置消息格式: "steps:<value>" 或 "delay:<value>"
        // 例如: "steps:400" 或 "delay:500"

        // 查找冒号分隔符
        const char *separator = strchr(payload, ':');
        if (separator == nullptr)
        {
            _instance->publishError("Invalid config format");
            return;
        }

        // 提取参数名称
        int nameLen = separator - payload;
        char paramName[20];
        if (nameLen >= 20)
        {
            _instance->publishError("Invalid config format");
            return;
        }
        strncpy(paramName, payload, nameLen);
        paramName[nameLen] = '\0';

        // 提取参数值
        const char *valueStr = separator + 1;
        if (valueStr[0] == '\0')
        {
            _instance->publishError("Invalid config format");
            return;
        }

        // 验证值是否为有效数字
        bool hasDigit = false;
        for (int i = 0; valueStr[i] != '\0'; i++)
        {
            if (valueStr[i] >= '0' && valueStr[i] <= '9')
            {
                hasDigit = true;
            }
            else
            {
                _instance->publishError("Invalid config value");
                return;
            }
        }

        if (!hasDigit)
        {
            _instance->publishError("Invalid config value");
            return;
        }

        // 解析值
        long value = atol(valueStr);

        // 根据参数名称设置配置
        if (strcmp(paramName, "steps") == 0)
        {
            if (value <= 0 || value > 10000)
            {
                _instance->publishError("Steps out of range (1-10000)");
                return;
            }
            _instance->setStepsPerRevolution((int)value);
            _instance->publishConfig();
        }
        else if (strcmp(paramName, "delay") == 0)
        {
            if (value < 100 || value > 100000)
            {
                _instance->publishError("Delay out of range (100-100000 us)");
                return;
            }
            _instance->setStepDelay((unsigned long)value);
            _instance->publishConfig();
        }
        else
        {
            _instance->publishError("Unknown config parameter");
        }
    }
}

// 发布当前配置
void StepperMotor::publishConfig()
{
    char configMsg[50];
    snprintf(configMsg, sizeof(configMsg), "steps:%d,delay:%lu",
             _stepsPerRevolution, _stepDelayMicros);
    _pubsub->publish("motor/config/status", configMsg);
}

// 发布当前位置
void StepperMotor::publishPosition()
{
    // 计算圈数（保留两位小数）
    long revolutions_x100 = (_currentSteps * 100L) / _stepsPerRevolution;

    // 计算位置mm（保留两位小数）
    long position_mm_x100 = (revolutions_x100 * 16L) / 10L; // 1.6mm per rev = 16/10

    char posMsg[64];
    // 整数部分,小数部分
    snprintf(posMsg, sizeof(posMsg), "%ld.%02ld,%ld.%02ld",
             revolutions_x100 / 100, abs(revolutions_x100 % 100),
             position_mm_x100 / 100, abs(position_mm_x100 % 100));
    _pubsub->publish("motor/position", posMsg);
}

// 校准回调（将当前位置设为0）
void StepperMotor::calibrateCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        if (_instance->_isBusy)
        {
            _instance->publishError("Motor busy");
            return;
        }

        // 将当前位置设为0
        _instance->_currentSteps = 0;
        _instance->publishStatus("calibrated");
        _instance->publishPosition();
    }
}

// 回零回调（移动到0位置）
void StepperMotor::homeCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        if (_instance->_isBusy)
        {
            _instance->publishError("Motor busy");
            return;
        }

        // 计算需要移动的圈数（回到0位置）
        float currentRevolutions = (float)_instance->_currentSteps / _instance->_stepsPerRevolution;
        float moveRevolutions = -currentRevolutions; // 反向移动

        // 执行回零
        _instance->rotate(moveRevolutions);
    }
}

// 位置查询回调
void StepperMotor::positionCallback(const char *topic, const char *payload)
{
    if (_instance != nullptr)
    {
        _instance->publishPosition();
    }
}
